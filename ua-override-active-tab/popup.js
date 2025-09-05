// --- helpers ---
function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function clearSessionRules() {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const ids = existing.map(r => r.id);
  if (ids.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
}

async function getActiveTabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) throw new Error('No active tab URL available.');
  const u = new URL(tab.url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Active tab is not an http(s) page.');
  }
  const scheme = u.protocol.slice(0, -1); // "http" or "https"
  const hostRx = escapeRx(u.hostname);
  const portRx = u.port ? (':' + u.port) : '(?::\\d+)?';
  const originRx = `^${scheme}://${hostRx}${portRx}/.*`;
  return { tabId: tab.id, origin: u.origin, originRx };
}

// Build a rule that targets the active tab's origin (all resource types)
function ruleActiveTabAll(id, uaValue, tabId, originRx) {
  return {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'User-Agent', operation: 'set', value: uaValue }]
    },
    condition: {
      regexFilter: originRx,
      tabIds: [tabId]
      // resourceTypes omitted => main_frame + subresources
    }
  };
}

// Same but XHR-only
function ruleActiveTabXHROnly(id, uaValue, tabId, originRx) {
  return {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'User-Agent', operation: 'set', value: uaValue }]
    },
    condition: {
      regexFilter: originRx,
      tabIds: [tabId],
      resourceTypes: ['xmlhttprequest']
    }
  };
}

async function setUA(uaKey) {
  try {
    const { tabId, origin, originRx } = await getActiveTabInfo();
    await clearSessionRules();

    let rules;
    switch (uaKey) {
      // CAPTCHA
      case 'BLOCKUA':
        rules = [ruleActiveTabAll(1, 'BLOCKUA', tabId, originRx)];
        break;
      case 'BLOCKUA-HARDBLOCK':
        rules = [ruleActiveTabAll(1, 'BLOCKUA-HARDBLOCK', tabId, originRx)];
        break;

      // DeviceCheck
      case 'DeviceCheckTestUA':
        rules = [ruleActiveTabAll(1, 'DeviceCheckTestUA', tabId, originRx)];
        break;
      case 'DeviceCheckTestUA-BLOCKUA':
        rules = [ruleActiveTabAll(1, 'DeviceCheckTestUA-BLOCKUA', tabId, originRx)];
        break;
      case 'DeviceCheckTestUA-HARDBLOCK':
        rules = [ruleActiveTabAll(1, 'DeviceCheckTestUA-HARDBLOCK', tabId, originRx)];
        break;

      // HARDBLOCK
      case 'HARDBLOCKUA':
        rules = [ruleActiveTabAll(1, 'HARDBLOCKUA', tabId, originRx)];
        break;
      case 'HARDBLOCK_UA':
        // Special: XHR only
        rules = [ruleActiveTabXHROnly(1, 'HARDBLOCK_UA', tabId, originRx)];
        break;

      default:
        alert('Unknown UA preset');
        return;
    }

    await chrome.declarativeNetRequest.updateSessionRules({ addRules: rules });
    await chrome.storage.local.set({ uaActive: uaKey, tabId, origin });
    alert(`UA set: ${uaKey}\nScope: active tab only @ ${origin}\nPersists on refresh (session-scoped).`);

  } catch (e) {
    alert(`Cannot apply UA: ${e.message}`);
  }
}

async function clearOverride() {
  await clearSessionRules();
  await chrome.storage.local.remove(['uaActive', 'tabId', 'origin']);
  alert('UA override cleared for active tab.');
}

// --- wire UI ---
document.getElementById('ua_BLOCKUA').onclick = () => setUA('BLOCKUA');
document.getElementById('ua_BLOCKUA_HARDBLOCK').onclick = () => setUA('BLOCKUA-HARDBLOCK');

document.getElementById('ua_DeviceCheckTestUA').onclick = () => setUA('DeviceCheckTestUA');
document.getElementById('ua_DeviceCheckTestUA_BLOCKUA').onclick = () => setUA('DeviceCheckTestUA-BLOCKUA');
document.getElementById('ua_DeviceCheckTestUA_HARDBLOCK').onclick = () => setUA('DeviceCheckTestUA-HARDBLOCK');

document.getElementById('ua_HARDBLOCKUA').onclick = () => setUA('HARDBLOCKUA');
document.getElementById('ua_HARDBLOCK_UA').onclick = () => setUA('HARDBLOCK_UA');

document.getElementById('clear').onclick = () => clearOverride();

// Show active origin in the popup
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const origin = tab?.url ? new URL(tab.url).origin : '(no active tab)';
    document.getElementById('origin').textContent = `Active tab origin: ${origin}`;
  } catch {
    document.getElementById('origin').textContent = 'Active tab origin: (not available)';
  }
})();
