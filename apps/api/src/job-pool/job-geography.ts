export const POOL_COUNTRIES = ['US', 'GB', 'IE'] as const;
export type PoolCountry = typeof POOL_COUNTRIES[number];
export const COUNTRY_NAMES: Record<PoolCountry, string> = { US: 'United States', GB: 'United Kingdom', IE: 'Ireland' };

export function poolCountry(value: unknown): PoolCountry | null {
  if (typeof value !== 'string') return null;
  const country = value.trim();
  if (/^(?:US|USA|United States(?: of America)?)$/i.test(country)) return 'US';
  if (/^(?:GB|GBR|UK|U\.K\.|United Kingdom|Great Britain|Britain|England|Scotland|Wales|Northern Ireland)$/i.test(country)) return 'GB';
  if (/^(?:IE|IRL|Ireland|Republic of Ireland|Eire|Éire)$/i.test(country)) return 'IE';
  return null;
}

export function unrestrictedWorldwide(location: unknown): boolean {
  if (typeof location !== 'string' || !/\b(?:worldwide|global|anywhere)\b/i.test(location)) return false;
  return !location.replace(/\b(?:work from anywhere|worldwide|global|anywhere|fully remote|remote|fully)\b|100%/gi, '').replace(/[\s\p{P}]/gu, '');
}

const US_STATES = /\b(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)\b/i;
const US_CITIES = /\b(?:San Francisco|San Jose|Los Angeles|San Diego|New York City|NYC|Seattle|Boston|Chicago|Austin|Dallas|Houston|Denver|Atlanta|Miami|Philadelphia|Phoenix|Salt Lake City|Portland|Pittsburgh|Raleigh|San Antonio|Minneapolis|Nashville|Detroit|Baltimore|Washington DC)\b/i;
const COUNTRY_PATTERNS: Record<PoolCountry, string> = {
  US: '(?:US|USA|U\\.S\\.(?:A\\.)?|United States(?: of America)?)',
  GB: '(?:UK|GB|GBR|U\\.K\\.|United Kingdom|Great Britain|Britain|England|Scotland|Wales|Northern Ireland)',
  IE: '(?:IE|IRL|Republic of Ireland|Ireland|Éire|Eire)',
};

export function excludedCountries(text: string): PoolCountry[] {
  return POOL_COUNTRIES.filter(code => {
    const name = COUNTRY_PATTERNS[code];
    // Northern Ireland is part of the UK; excluding it does not exclude Ireland.
    const value = code === 'IE' ? text.replace(/Northern Ireland/gi, '') : text;
    return new RegExp(`\\b(?:except|excluding|outside|not (?:in|available in|open to)|ineligible (?:in|for))\\s+(?:the\\s+)?${name}\\b|\\b${name}\\s+(?:applicants|residents|candidates)\\s+(?:are\\s+)?not eligible\\b`, 'i').test(value);
  });
}

export function eligibleCountries(location: unknown, country?: unknown, description = ''): PoolCountry[] {
  const text = typeof location === 'string' ? location.replace(/_/g, ' ').trim() : '';
  let result: PoolCountry[] = [];
  // A structured country is authoritative. Unknown/foreign country codes must
  // not be overridden by an ambiguous city or an employer's headquarters.
  if (typeof country === 'string' && country.trim()) {
    const code = poolCountry(country); if (code) result = [code];
  } else if (unrestrictedWorldwide(text)) result = [...POOL_COUNTRIES];
  else {
    if (/\b(?:United States(?: of America)?|USA|US)\b|\bU\.S\.(?:A\.)?/i.test(text)) result.push('US');
    if (/\b(?:UK|GB|GBR|United Kingdom|Great Britain|Britain|England|Scotland|Wales|Northern Ireland)\b|\bU\.K\./i.test(text)) result.push('GB');
    if (/\b(?:Ireland|Republic of Ireland|IRL|IE|Eire|Éire)\b/i.test(text.replace(/Northern Ireland/gi, ''))) result.push('IE');
    const foreign = /\b(?:Canada|Germany|India|Australia|Mexico|Brazil|Singapore|France|Poland|Netherlands|Spain|Romania|Portugal|South Africa)\b/i.test(text.replace(/New Mexico/gi, ''));
    if (!result.length && !foreign && !/\b(?:Europe|EMEA|EU|APAC)\b/i.test(text)) {
      const usCode = /(?:,|\()\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/.test(text);
      if (usCode || US_CITIES.test(text) || (US_STATES.test(text) && (!/\bGeorgia\b/i.test(text) || /\bAtlanta\b|\bGA\b/.test(text)))) result.push('US');
      else if (!US_STATES.test(text) && /\b(?:London|Manchester|Edinburgh|Bristol|Glasgow|Belfast|Cardiff|Leeds|Nottingham|Newcastle upon Tyne|Brighton|Oxford)\b/i.test(text) && !/\b(?:Ontario|ON)\b/i.test(text)) result.push('GB');
      else if (!US_STATES.test(text) && /\b(?:Dublin|Galway|Cork|Limerick|Waterford)\b/i.test(text)) result.push('IE');
    }
  }
  const excluded = excludedCountries(`${text}\n${description}`);
  const names = '(?:United States|USA|US|United Kingdom|UK|Great Britain|Republic of Ireland|Ireland)';
  const residence = new RegExp(`\\b(?:must|need to|required to)\\s+(?:currently\\s+)?(?:be based|reside|live|be located)\\s+in\\s+(?:the\\s+)?(${names}(?:\\s*(?:,|and|or|/|&)\\s*(?:the\\s+)?${names})*)\\b`, 'i').exec(description);
  const foreignNames = '(?:Canada|Germany|India|Australia|Mexico|Brazil|Singapore|France|Poland|Netherlands|Spain|Romania|Portugal|South Africa|New Zealand)';
  if (new RegExp(`\\b(?:must|need to|required to)\\s+(?:currently\\s+)?(?:be based|reside|live|be located)\\s+in\\s+(?:the\\s+)?${foreignNames}\\b`, 'i').test(description)) return [];
  const countryList = `${names}(?:\\s*(?:,|and|or|/|&)\\s*(?:the\\s+)?${names})*`;
  const only = new RegExp(`\\b(${countryList})\\s+(?:applicants|candidates|residents)\\s+only\\b|\\b(?:only (?:hiring|accepting)\\s+(?:(?:candidates|applicants)\\s+)?(?:in|from)|(?:open|available) only to|only (?:open|available) to)\\s+(?:the\\s+)?(${countryList})\\b`, 'i').exec(description);
  const required = residence ? eligibleCountries(residence[1]) : [];
  const onlyCountries = only ? eligibleCountries(only[1] || only[2]) : [];
  return POOL_COUNTRIES.filter(code => result.includes(code) && !excluded.includes(code) && (!required.length || required.includes(code)) && (!onlyCountries.length || onlyCountries.includes(code)));
}
