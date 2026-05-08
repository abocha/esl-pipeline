export interface TimezoneOption {
  value: string;
  label: string;
}

export const TIMEZONE_OPTIONS: readonly TimezoneOption[] = [
  { value: 'America/Los_Angeles', label: 'Los Angeles (UTC-8/-7)' },
  { value: 'America/Denver', label: 'Denver (UTC-7/-6)' },
  { value: 'America/Chicago', label: 'Chicago (UTC-6/-5)' },
  { value: 'America/New_York', label: 'New York (UTC-5/-4)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (UTC+0/+1)' },
  { value: 'Europe/Berlin', label: 'Berlin / Paris (UTC+1/+2)' },
  { value: 'Europe/Moscow', label: 'Moscow / Istanbul (UTC+3)' },
  { value: 'Asia/Dubai', label: 'Dubai (UTC+4)' },
  { value: 'Asia/Tbilisi', label: 'Tbilisi (UTC+4)' },
  { value: 'Asia/Almaty', label: 'Almaty (UTC+5)' },
  { value: 'Asia/Kolkata', label: 'India (UTC+5:30)' },
  { value: 'Asia/Bishkek', label: 'Bishkek (UTC+6)' },
  { value: 'Asia/Bangkok', label: 'Bangkok (UTC+7)' },
  { value: 'Asia/Singapore', label: 'Singapore / Shanghai (UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (UTC+9)' },
  { value: 'Australia/Sydney', label: 'Sydney (UTC+10/+11)' },
];
