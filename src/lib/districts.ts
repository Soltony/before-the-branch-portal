export type District = { id: string; code: number; name: string; address: string };

/**
 * EB.DISTRICT default list. `id` is the zero-padded form Lersha and the core
 * banking system use for codes below 10 ("01".."09"); `code` is the numeric
 * form stored on User.districtCode and LershaFarmer.districtCode.
 */
export const DISTRICTS: District[] = [
  { id: '01', code: 1, name: 'Central AA District', address: 'AA' },
  { id: '02', code: 2, name: 'North East AA District', address: 'AA' },
  { id: '03', code: 3, name: 'North West AA District', address: 'AA' },
  { id: '04', code: 4, name: 'South East AA District', address: 'AA' },
  { id: '05', code: 5, name: 'Hossaena District', address: 'Hossaena' },
  { id: '06', code: 6, name: 'Hawassa District', address: 'Hawassa' },
  { id: '07', code: 7, name: 'Bahirdar District', address: 'Bahirdar' },
  { id: '08', code: 8, name: 'Dire Dawa District', address: 'Dire Dawa' },
  { id: '09', code: 9, name: 'Jimma District', address: 'Jimma' },
  { id: '10', code: 10, name: 'Head Office', address: 'AA' },
  { id: '11', code: 11, name: 'Premium', address: 'AA' },
  { id: '12', code: 12, name: 'Special', address: 'AA' },
  { id: '13', code: 13, name: 'South Addis Ababa District', address: 'AA' },
  { id: '14', code: 14, name: 'North Addis Ababa District', address: 'AA' },
  { id: '15', code: 15, name: 'East Addis Ababa District', address: 'AA' },
  { id: '16', code: 16, name: 'West Addis Ababa District', address: 'AA' },
  { id: '17', code: 17, name: 'Adama District', address: 'Adama Oro' },
  { id: '18', code: 18, name: 'Dessie District', address: 'Dessie Amhara' },
  { id: '19', code: 19, name: 'Mekelle District', address: 'Mekelle Tigray' },
  { id: '20', code: 20, name: 'Wolikite District', address: 'Wolikite' },
];

const DISTRICT_BY_CODE = new Map(DISTRICTS.map((d) => [d.code, d]));

export function districtIdToCode(districtId: string): number {
  return parseInt(districtId, 10);
}

export function districtCodeToId(code: number): string {
  return String(code).padStart(2, '0');
}

export function isValidDistrictCode(code: number): boolean {
  return DISTRICT_BY_CODE.has(code);
}

/**
 * Lersha sends the district code as either the padded string ("07") or a plain
 * number (7), so accept both and reject anything outside the known list —
 * an unrecognised code would silently hide the farmer from every district user.
 */
export function normalizeDistrictCode(value: unknown): number | null {
  if (value == null || value === '') return null;

  const code =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? parseInt(value.trim(), 10)
        : NaN;

  if (!Number.isInteger(code) || !isValidDistrictCode(code)) return null;
  return code;
}

export function getDistrictLabel(code: number | null | undefined): string {
  if (code == null) return 'N/A';
  const district = DISTRICT_BY_CODE.get(code);
  return district ? `${districtCodeToId(code)} - ${district.name}` : String(code);
}

export function getDistrictName(code: number | null | undefined): string | null {
  if (code == null) return null;
  return DISTRICT_BY_CODE.get(code)?.name ?? null;
}
