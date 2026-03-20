// Settings management - load/save from sessionStorage

const STORAGE_KEY = 'atDashboardSettings';

const AUTOTASK_ZONES = {
  '1': 'https://webservices1.autotask.net/ATServicesRest',
  '2': 'https://webservices2.autotask.net/ATServicesRest',
  '3': 'https://webservices3.autotask.net/ATServicesRest',
  '4': 'https://webservices4.autotask.net/ATServicesRest',
  '5': 'https://webservices5.autotask.net/ATServicesRest',
  '6': 'https://webservices6.autotask.net/ATServicesRest'
};

export { AUTOTASK_ZONES };

/**
 * Get all saved settings
 */
export function getSettings() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : getDefaults();
  } catch {
    return getDefaults();
  }
}

/**
 * Save settings to sessionStorage
 */
export function saveSettings(settings) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Get default settings structure
 */
export function getDefaults() {
  return {
    worker: {
      url: ''
    },
    autotask: {
      zone: '',
      customUrl: '',
      username: '',
      secret: '',
      integrationCode: ''
    },
    llm: {
      endpointUrl: '',
      apiKey: '',
      model: 'claude-sonnet-4-20250514'
    }
  };
}

/**
 * Get the resolved Autotask base URL from settings
 */
export function getAutotaskBaseUrl(settings) {
  if (settings.autotask.zone === 'custom') {
    return settings.autotask.customUrl;
  }
  return AUTOTASK_ZONES[settings.autotask.zone] || '';
}
