/** Countries for the phone number picker: [ISO code, name, dial code]. Sorted by name. */
export const COUNTRIES: [string, string, string][] = [
  ["AR", "Argentina", "54"],
  ["AU", "Australia", "61"],
  ["AT", "Austria", "43"],
  ["BE", "Belgium", "32"],
  ["BR", "Brazil", "55"],
  ["CA", "Canada", "1"],
  ["CL", "Chile", "56"],
  ["CN", "China", "86"],
  ["CO", "Colombia", "57"],
  ["DK", "Denmark", "45"],
  ["EG", "Egypt", "20"],
  ["FI", "Finland", "358"],
  ["FR", "France", "33"],
  ["DE", "Germany", "49"],
  ["GH", "Ghana", "233"],
  ["GR", "Greece", "30"],
  ["HK", "Hong Kong", "852"],
  ["IN", "India", "91"],
  ["ID", "Indonesia", "62"],
  ["IE", "Ireland", "353"],
  ["IL", "Israel", "972"],
  ["IT", "Italy", "39"],
  ["JM", "Jamaica", "1"],
  ["JP", "Japan", "81"],
  ["KE", "Kenya", "254"],
  ["MY", "Malaysia", "60"],
  ["MX", "Mexico", "52"],
  ["NL", "Netherlands", "31"],
  ["NZ", "New Zealand", "64"],
  ["NG", "Nigeria", "234"],
  ["NO", "Norway", "47"],
  ["PK", "Pakistan", "92"],
  ["PE", "Peru", "51"],
  ["PH", "Philippines", "63"],
  ["PL", "Poland", "48"],
  ["PT", "Portugal", "351"],
  ["PR", "Puerto Rico", "1"],
  ["SA", "Saudi Arabia", "966"],
  ["SG", "Singapore", "65"],
  ["ZA", "South Africa", "27"],
  ["KR", "South Korea", "82"],
  ["ES", "Spain", "34"],
  ["SE", "Sweden", "46"],
  ["CH", "Switzerland", "41"],
  ["TW", "Taiwan", "886"],
  ["TH", "Thailand", "66"],
  ["TR", "Türkiye", "90"],
  ["UA", "Ukraine", "380"],
  ["AE", "United Arab Emirates", "971"],
  ["GB", "United Kingdom", "44"],
  ["US", "United States", "1"],
  ["VN", "Vietnam", "84"],
];

/** Guesses the user's country from the browser language (e.g. "en-GB" → GB), defaulting to US. */
export function guessCountry(): string {
  const region = (typeof navigator !== "undefined" ? navigator.language : "").split("-")[1]?.toUpperCase();
  return COUNTRIES.some(([iso]) => iso === region) ? region! : "US";
}

/** Builds an E.164 number from a country and what the user typed. A leading "+" means they typed it in full. */
export function toE164(iso: string, typed: string): string {
  const digits = typed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  const dial = COUNTRIES.find(([c]) => c === iso)?.[2] ?? "1";
  return `+${dial}${digits.replace(/^0+/, "")}`;
}
