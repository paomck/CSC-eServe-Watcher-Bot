'use strict';

/**
 * watcher.js — CSC eServe Slot Watcher
 *
 * The portal uses NATIVE <select> dropdowns (confirmed from page-loaded screenshot).
 * Playwright's page.selectOption() works perfectly for these.
 *
 * Flow per cycle:
 *   1. Launch Firefox, inject cookie, navigate to /client/services
 *   2. Select Region = "NCR"
 *   3. For each of the 24 NCR field offices:
 *      a. Select Location
 *      b. Select Service Application = "Career Service - Professional"
 *      c. Scan calendar for green (available) cells
 *      d. Record result
 */

const { firefox } = require('playwright');
const fs   = require('fs');
const path = require('path');
const logger = require('./logger');

// ─── Constants ────────────────────────────────────────────────────────────────

const PORTAL_URL   = 'https://services.csc.gov.ph';
const SCHEDULE_URL = `${PORTAL_URL}/client/services`;

const TIMEOUTS = {
  navigation: 30_000,
  element:    15_000,
  calendar:   25_000,
  settle:      8_000,   // increased — portal AJAX can be slow
};

const NCR_LOCATIONS = [
  'CSC Regional Office NCR',
  'CSC FO DOST',
  'CSC FO BIR',
  'CSC FO COA',
  'CSC FO HREP',
  'CSC FO DPWH',
  'CSC FO BSP',
  'CSC FO DBP',
  'CSC FO Makati',
  'CSC FO Manila',
  'CSC FO GSIS',
  'CSC FO TESDA',
  'CSC FO PCC',
  'CSC FO DILG',
  'CSC FO BFP',
  'CSC FO NIA',
  'CSC FO UP',
  'CSC FO Caloocan City Government',
  'CSC FO DOH',
  'CSC FO DND',
  'CSC FO DENR',
  'CSC FO DA',
  'CSC FO OP',
  'CSC FO PNP',
];

// ─── Cookie parser ────────────────────────────────────────────────────────────

function parseCookies(rawCookie, domain) {
  if (!rawCookie || rawCookie.trim() === 'YOUR_SESSION_COOKIE_HERE') {
    throw new Error('ESERVE_COOKIE is not set. Please update your .env file.');
  }
  return rawCookie.split(';').map((p) => p.trim()).filter(Boolean).map((pair) => {
    const idx = pair.indexOf('=');
    return {
      name:     pair.slice(0, idx).trim(),
      value:    pair.slice(idx + 1).trim(),
      domain,
      path:     '/',
      httpOnly: false,
      secure:   true,
      sameSite: 'Lax',
    };
  });
}

// ─── Screenshot helper ────────────────────────────────────────────────────────

async function saveScreenshot(page, label) {
  const dir  = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${ts}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  logger.debug(`Screenshot → ${file}`);
  return file;
}

// ─── DOM inspector (runs once to identify select IDs) ────────────────────────

async function inspectAndSaveDOM(page) {
  // Dump all <select> elements so we know exact IDs/names
  const selects = await page.evaluate(() =>
    Array.from(document.querySelectorAll('select')).map((s) => ({
      id:      s.id,
      name:    s.name,
      classes: s.className,
      options: Array.from(s.options).slice(0, 6).map((o) => `"${o.text.trim()}"(${o.value})`),
    }))
  );

  logger.info(`Found ${selects.length} <select> element(s) on page:`);
  selects.forEach((s) =>
    logger.info(`  id="${s.id}" name="${s.name}" class="${s.classes}" → [${s.options.join(', ')}]`)
  );

  // Save full HTML for offline inspection if needed
  const html = await page.content();
  const dir  = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'dom-snapshot.html'), html, 'utf8');
  logger.debug('DOM snapshot saved → screenshots/dom-snapshot.html');

  return selects;
}

// ─── Select helper for native <select> ───────────────────────────────────────

/**
 * Select an option from a native <select> element, identified by the visible
 * label text next to it on the page. Waits for AJAX to settle afterward.
 *
 * @param {import('playwright').Page} page
 * @param {string} labelText   - The label text (e.g. "Region", "Location")
 * @param {string} optionText  - Option to select (case-insensitive partial match)
 */
async function selectByLabel(page, labelText, optionText) {
  logger.info(`Selecting "${optionText}" in [${labelText}]…`);

  // Find the <select> associated with this label
  const selectHandle = await page.evaluateHandle((label) => {
    // Try matching by <label> text → for= attribute → getElementById
    const labels = Array.from(document.querySelectorAll('label'));
    const lbl = labels.find((l) =>
      l.textContent.trim().toLowerCase().includes(label.toLowerCase())
    );

    if (lbl) {
      if (lbl.htmlFor) {
        const el = document.getElementById(lbl.htmlFor);
        if (el && el.tagName === 'SELECT') return el;
      }
      // Label wraps the select, or select is a sibling
      const parent = lbl.closest('.form-group, .row, .col, div');
      if (parent) {
        const el = parent.querySelector('select');
        if (el) return el;
      }
    }
    return null;
  }, labelText);

  const el = selectHandle.asElement();

  if (!el) {
    // Fallback: log all selects to help debug, then throw
    const allSelects = await page.evaluate(() =>
      Array.from(document.querySelectorAll('select')).map((s) => ({
        id: s.id, name: s.name,
        opts: Array.from(s.options).slice(0, 5).map((o) => o.text.trim()),
      }))
    );
    logger.error(`Could not find <select> for label "${labelText}". All selects on page:`);
    allSelects.forEach((s) => logger.error(`  id="${s.id}" name="${s.name}" opts=[${s.opts.join(', ')}]`));
    throw new Error(`No <select> found for label "${labelText}"`);
  }

  // Wait until the select has real options loaded (AJAX may populate it)
  await page.waitForFunction(
    (element) => {
      const meaningful = Array.from(element.options).filter(
        (o) => o.value && o.value !== '' && o.text.trim() !== ''
      );
      return meaningful.length > 0;
    },
    el,
    { timeout: TIMEOUTS.element }
  );

  // Read available options
  const options = await el.evaluate((s) =>
    Array.from(s.options).map((o) => ({ value: o.value, text: o.text.trim() }))
  );
  logger.debug(`  Options: ${options.map((o) => o.text).join(' | ')}`);

  // Find case-insensitive partial match
  const match = options.find((o) => o.text.toLowerCase().includes(optionText.toLowerCase()));
  if (!match) {
    throw new Error(
      `"${optionText}" not found in [${labelText}]. ` +
      `Available: ${options.map((o) => o.text).join(', ')}`
    );
  }

  // Select by value (most reliable)
  await el.selectOption({ value: match.value });
  logger.ok(`  Selected: "${match.text}"`);

  // Wait for any AJAX triggered by the change event to settle.
  // Use a longer hard floor (5 s) so the calendar has time to render.
  await Promise.race([
    page.waitForLoadState('networkidle', { timeout: TIMEOUTS.settle }),
    page.waitForTimeout(5_000),
  ]).catch(() => {});
}

// ─── Calendar scanner ─────────────────────────────────────────────────────────

/**
 * Scan the FullCalendar.js calendar for available date cells.
 *
 * FullCalendar renders like this per day cell:
 *   <td class="fc-day-top fc-mon fc-past" data-date="2026-06-01">
 *     <div class="fc-day-number">1</div>
 *   </td>
 *
 * Available slots are marked with an additional class on the <td> — the green
 * color comes from a CSS stylesheet rule, not an inline style, so
 * getComputedStyle on the <td> itself returns transparent. We must check the
 * <td>'s children too, AND check for portal-specific class names.
 */
async function scanCalendarForSlots(page) {
  logger.info('Scanning calendar…');

  // Wait for FullCalendar to finish rendering
  try {
    await page.waitForSelector('.fc-view, .fc-body, .fc-day, [class*="fc-"]', {
      state: 'visible',
      timeout: TIMEOUTS.calendar,
    });
  } catch {
    logger.warn('FullCalendar not detected — skipping.');
    return { found: false, dates: [], rawCount: 0 };
  }

  // Extra settle time for the calendar AJAX data to load into the cells
  await page.waitForTimeout(2_000);

  const result = await page.evaluate(() => {
    // ── Helpers ────────────────────────────────────────────────────────────
    function isGreenComputed(el) {
      // Check el AND all its children for a green computed background
      const elements = [el, ...el.querySelectorAll('*')];
      for (const e of elements) {
        const bg = window.getComputedStyle(e).backgroundColor;
        if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') continue;
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) continue;
        const [, r, g, b] = m.map(Number);
        if (g > 100 && g > r * 1.3 && g > b * 1.3) return { yes: true, color: bg, tag: e.tagName, cls: e.className };
      }
      return { yes: false };
    }

    function hasAvailableClass(cls) {
      // Only match portal-specific availability class names.
      // Avoid 'active' and 'clickable' — FullCalendar uses these for today/hover,
      // not for slot availability, causing false positives.
      return /\bavail|\bslot\b|\bsuccess\b|\bfree\b|\bopen-slot\b|\bhas-slot\b/i.test(cls);
    }

    // ── Find all day cells ─────────────────────────────────────────────────
    const body  = document.querySelector('.fc-body, .fc-view-container, .fc-view, [class*="fc-body"]');
    const scope = body || document;
    const dayCells = scope.querySelectorAll('td[class*="fc-day"], td[data-date]');

    const availableDates = [];
    const allClasses     = new Set();
    const debugCells     = [];

    for (const cell of dayCells) {
      const cls      = cell.className || '';
      const dataDate = cell.getAttribute('data-date') || '';

      const isPast    = cls.includes('fc-past');
      const isToday   = cls.includes('fc-today');
      const isFuture  = cls.includes('fc-future');
      const isWeekend = cls.includes('fc-sun') || cls.includes('fc-sat');
      const isOther   = cls.includes('fc-other-month');

      // Extract date number
      let dateNum = '';
      if (dataDate) {
        dateNum = dataDate.split('-')[2]?.replace(/^0/, '');
      } else {
        const numEl = cell.querySelector('.fc-day-number, .fc-day-top');
        dateNum = (numEl?.textContent || cell.textContent).trim().match(/\d{1,2}/)?.[0] || '';
      }

      cls.split(/\s+/).filter(Boolean).forEach((c) => allClasses.add(c));

      // Class-name match only applies to future cells, not today —
      // FullCalendar may add its own highlight classes to today's cell.
      const greenResult = isGreenComputed(cell);
      const classMatch  = !isPast && !isToday && hasAvailableClass(cls);
      const isAvailable = greenResult.yes || classMatch;

      // Capture sample of future cells for debugging
      if ((isFuture || isToday) && !isWeekend && !isOther && debugCells.length < 8) {
        debugCells.push({
          date: dataDate || dateNum,
          cls: cls.slice(0, 120),
          bg: window.getComputedStyle(cell).backgroundColor,
          childBg: greenResult.color || 'none',
          available: isAvailable,
        });
      }

      if (isAvailable && dateNum && !isPast) {
        availableDates.push(dateNum);
      }
    }

    return {
      availableDates: [...new Set(availableDates)],
      totalCells: dayCells.length,
      allClasses: [...allClasses].sort(),
      debugCells,
    };
  });

  const { availableDates, totalCells, allClasses, debugCells } = result;

  if (totalCells === 0) {
    logger.warn('FullCalendar rendered but no td[data-date] day cells found. Calendar may still be loading.');
    return { found: false, dates: [], rawCount: 0 };
  }

  // Log all FC classes and sample cells — essential for tuning the detector
  logger.debug(`  FC classes seen: ${allClasses.join(' | ')}`);
  logger.debug(`  Future cell samples:`);
  debugCells.forEach((c) =>
    logger.debug(
      `    date="${c.date}" avail=${c.available} ` +
      `bg="${c.bg}" childBg="${c.childBg}" cls="${c.cls}"`
    )
  );

  if (availableDates.length > 0) {
    logger.ok(`🎉 Available date(s): ${availableDates.join(', ')}`);
    return { found: true, dates: availableDates, rawCount: totalCells };
  }

  logger.info(`No available slots (${totalCells} cells scanned).`);
  return { found: false, dates: [], rawCount: totalCells };
}

// ─── Per-location check ───────────────────────────────────────────────────────

async function checkOneLocation(page, location, service, index) {
  logger.info(`\n[${index}/${NCR_LOCATIONS.length}] Checking: ${location}`);
  try {
    await selectByLabel(page, 'Location', location);
    await selectByLabel(page, 'Service Application', service);
    const result = await scanCalendarForSlots(page);
    if (result.found) {
      await saveScreenshot(page, `FOUND-${location.replace(/[^a-z0-9]/gi, '_')}`);
    }
    return { location, ...result };
  } catch (err) {
    logger.warn(`  Error: ${err.message}`);
    try { await saveScreenshot(page, `error-${location.replace(/[^a-z0-9]/gi, '_')}`); } catch (_) {}
    return { location, found: false, dates: [], rawCount: 0, error: err.message };
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

async function checkAllLocations({ cookie, region, service, locations = NCR_LOCATIONS }) {
  let browser = null;
  try {
    logger.info('Launching headless Firefox…');
    browser = await firefox.launch({ headless: true });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
      viewport:  { width: 1280, height: 900 },
      locale:    'en-PH',
    });

    logger.info('Injecting session cookie…');
    await context.addCookies(parseCookies(cookie, 'services.csc.gov.ph'));

    const page = await context.newPage();
    await page.route('**/*.{png,jpg,jpeg,gif,webp,ico,woff,woff2,ttf,otf,mp4,mp3}', (r) => r.abort());

    logger.info(`Navigating to ${SCHEDULE_URL}…`);
    const response = await page.goto(SCHEDULE_URL, {
      waitUntil: 'networkidle',
      timeout:   TIMEOUTS.navigation,
    });

    const finalUrl = page.url();
    if (finalUrl.includes('login') || finalUrl.includes('signin') || response?.status() === 401) {
      await saveScreenshot(page, 'session-expired');
      throw new Error('Session expired — refresh ESERVE_COOKIE in .env.');
    }

    logger.ok(`Page loaded: ${finalUrl}`);
    await saveScreenshot(page, 'page-loaded');

    // Inspect DOM to log all select IDs — helps debug if selects change
    await inspectAndSaveDOM(page);

    // Select Region once (persists across location iterations)
    await selectByLabel(page, 'Region', region);

    const results = [];
    for (let i = 0; i < locations.length; i++) {
      results.push(await checkOneLocation(page, locations[i], service, i + 1));
    }
    return results;

  } catch (err) {
    logger.error('Fatal error:', err.message);
    return [{ location: '__fatal__', found: false, dates: [], rawCount: 0, error: err.message }];
  } finally {
    if (browser) { await browser.close(); logger.debug('Browser closed.'); }
  }
}

module.exports = { checkAllLocations, NCR_LOCATIONS, PORTAL_URL, SCHEDULE_URL };
