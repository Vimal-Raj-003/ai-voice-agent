export function businessName(metadata: unknown): string {
  const value = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).businessName : null;
  return typeof value === 'string' ? value : '';
}

export function withBusinessName(metadata: unknown, form: FormData) {
  const existing = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown> : {};
  const name=String(form.get('businessName') || '').trim();
  return {...existing, businessName:name,
    ...(existing.setupRequired===true&&name&&name!==existing.businessName?{setupRequired:false}:{})};
}
