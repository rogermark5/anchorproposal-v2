class SortUnavailable extends Error {}

// Runs inside the page. Jobright uses an Ant Design select whose value lives in React state.
function sortElement(action, target) {
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = element => { const box = element.getBoundingClientRect(), style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'; };
  const labels = ['recommended', 'most recent', 'top matched', 'top match'];
  if (action === 'option') return [...document.querySelectorAll('.ant-select-item-option,[role="option"]')].find(element => visible(element) && normalize(element.getAttribute('title') || element.textContent) === normalize(target)) || false;
  const native = [...document.querySelectorAll('select')].find(element => visible(element) && [...element.options].some(option => normalize(option.textContent) === 'most recent'));
  const custom = [...document.querySelectorAll('.ant-select,button[aria-haspopup="listbox"],[role="combobox"]')].find(element => {
    if (!visible(element)) return false;
    const selected = element.querySelector('.ant-select-selection-item');
    return labels.includes(normalize(selected?.getAttribute('title') || selected?.textContent || element.value || element.textContent));
  });
  const control = native || custom; if (!control) return false;
  const item = control.querySelector('.ant-select-selection-item');
  const selected = normalize(native ? native.selectedOptions[0]?.textContent : item?.getAttribute('title') || item?.textContent || control.value || control.textContent);
  if (action === 'control') return native || control.querySelector('.ant-select-selector') || control;
  if (action === 'selected') return selected === normalize(target);
  if (action === 'nativeValue') return native ? [...native.options].find(option => normalize(option.textContent) === normalize(target))?.value : null;
  return { native: !!native, selected, expanded: (control.getAttribute('aria-expanded') || control.querySelector('[role="combobox"]')?.getAttribute('aria-expanded')) === 'true' };
}

async function selectMostRecent(page, { beforeSelect = () => {}, stop = () => false, timeoutMs = 15000 } = {}) {
  const wait = async (action, label) => {
    const until = Date.now() + timeoutMs;
    while (!stop() && Date.now() < until) {
      try { return await page.waitForFunction(sortElement, { timeout: Math.min(1000, Math.max(1, until - Date.now())), polling: 100 }, action, label); }
      catch { /* React can hydrate or replace the control while a watch is paused. */ }
    }
    throw new SortUnavailable('Could not verify Jobright Most Recent. Show the browser on Ubuntu, sign in and check the jobs sort dropdown before continuing.');
  };
  await (await wait('control')).dispose();
  const choose = async label => {
    if (stop()) return;
    const state = await page.evaluate(sortElement, 'state');
    if (state.native) {
      const value = await page.evaluate(sortElement, 'nativeValue', label);
      if (typeof value !== 'string') throw new SortUnavailable('Jobright Most Recent is unavailable. Open login and check the jobs sort dropdown.');
      const control = await page.evaluateHandle(sortElement, 'control');
      beforeSelect(label); await control.asElement().select(value); await control.dispose();
    } else {
      const until = Date.now() + timeoutMs; let option, lastClick = 0;
      while (!option && !stop() && Date.now() < until) {
        const candidate = await page.evaluateHandle(sortElement, 'option', label);
        if (candidate.asElement()) { option = candidate; break; } await candidate.dispose();
        const state = await page.evaluate(sortElement, 'state');
        if (state && !state.expanded && Date.now() - lastClick >= 500) {
          const control = await page.evaluateHandle(sortElement, 'control');
          try { await control.asElement()?.click(); } finally { await control.dispose(); }
          lastClick = Date.now();
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (stop()) return;
      if (!option) throw new SortUnavailable('Jobright Most Recent is unavailable. Open login and check the jobs sort dropdown.');
      beforeSelect(label); await option.asElement().click(); await option.dispose();
    }
    await (await wait('selected', label)).dispose();
  };
  // Re-select through another supported option when persisted as Most Recent.
  // This forces a fresh listing response instead of trusting stale server-rendered data.
  if ((await page.evaluate(sortElement, 'state')).selected === 'most recent') await choose('Recommended');
  await choose('Most Recent');
  return !stop() && await page.evaluate(sortElement, 'selected', 'Most Recent');
}
module.exports = { selectMostRecent, sortElement, SortUnavailable };
