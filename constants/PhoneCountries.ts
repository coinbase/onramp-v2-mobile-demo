/**
 * CDP-supported countries for SMS authentication
 * This is the single source of truth for phone number country codes
 */

export const PHONE_COUNTRIES = [
  { name: 'United States', code: '+1', flag: '🇺🇸', minDigits: 10, applePayCompatible: true },
  { name: 'Australia', code: '+61', flag: '🇦🇺', minDigits: 9 },
  { name: 'Brazil', code: '+55', flag: '🇧🇷', minDigits: 10 },
  { name: 'Canada', code: '+1', flag: '🇨🇦', minDigits: 10 },
  { name: 'Colombia', code: '+57', flag: '🇨🇴', minDigits: 10 },
  { name: 'France', code: '+33', flag: '🇫🇷', minDigits: 9 },
  { name: 'Germany', code: '+49', flag: '🇩🇪', minDigits: 10 },
  { name: 'India', code: '+91', flag: '🇮🇳', minDigits: 10 },
  { name: 'Indonesia', code: '+62', flag: '🇮🇩', minDigits: 10 },
  { name: 'Italy', code: '+39', flag: '🇮🇹', minDigits: 9 },
  { name: 'Japan', code: '+81', flag: '🇯🇵', minDigits: 10 },
  { name: 'Kenya', code: '+254', flag: '🇰🇪', minDigits: 9 },
  { name: 'Mexico', code: '+52', flag: '🇲🇽', minDigits: 10 },
  { name: 'Netherlands', code: '+31', flag: '🇳🇱', minDigits: 9 },
  { name: 'Philippines', code: '+63', flag: '🇵🇭', minDigits: 10 },
  { name: 'Poland', code: '+48', flag: '🇵🇱', minDigits: 9 },
  { name: 'Singapore', code: '+65', flag: '🇸🇬', minDigits: 8 },
  { name: 'South Korea', code: '+82', flag: '🇰🇷', minDigits: 9 },
  { name: 'Spain', code: '+34', flag: '🇪🇸', minDigits: 9 },
  { name: 'Sweden', code: '+46', flag: '🇸🇪', minDigits: 9 },
  { name: 'Switzerland', code: '+41', flag: '🇨🇭', minDigits: 9 },
  { name: 'UAE', code: '+971', flag: '🇦🇪', minDigits: 9 },
  { name: 'United Kingdom', code: '+44', flag: '🇬🇧', minDigits: 10 },
];

export type PhoneCountry = typeof PHONE_COUNTRIES[number];
