/** Brand-neutral tokens. Both web (Tailwind theme) and mobile (StyleSheet) read from here. */
export const colors = {
  primary: '#1d4ed8',
  primaryText: '#ffffff',
  surface: '#ffffff',
  surfaceMuted: '#f5f6f8',
  text: '#111827',
  textMuted: '#6b7280',
  success: '#15803d',
  warning: '#b45309',
  danger: '#b91c1c',
  border: '#e5e7eb',
} as const

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const

/** Field staff use phones one-handed in sunlight: large tap targets and high contrast are not optional. */
export const touch = { minTarget: 48 } as const
