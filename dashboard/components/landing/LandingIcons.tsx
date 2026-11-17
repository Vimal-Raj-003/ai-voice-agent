

import React from 'react';

type IconProps = {
  className?: string;
  style?: React.CSSProperties;
};

export const LayoutDashboardIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
  </svg>
);

export const PhoneCallIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
  </svg>
);

export const CalendarDaysIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0h18M3 12h18" />
  </svg>
);

export const CreditCardIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 18.75 4.5h-15A2.25 2.25 0 0 0 1.5 6.75v10.5A2.25 2.25 0 0 0 3.75 19.5Z" />
  </svg>
);

export const PackageIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
    </svg>
);

export const ChartBarIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
);

export const EnvelopeIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
  </svg>
);

export const MapPinIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
  </svg>
);

export const IsoCertificateIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M12 21.75c-2.43 0-4.72-.9-6.48-2.48-1.76-1.58-2.52-3.8-2.52-6.22V6.75a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 6.75v6.3c0 2.42-1.02 4.64-2.52 6.22-1.76 1.58-4.05 2.48-6.48 2.48z" />
  </svg>
);

export const LanguageIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" />
    </svg>
);

export const CpuChipIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.5A2.25 2.25 0 016 2.25h12A2.25 2.25 0 0120.25 4.5v15A2.25 2.25 0 0118 21.75H6A2.25 2.25 0 013.75 19.5v-15z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5m7.5 0v1.5m-7.5 15v1.5m7.5 0v1.5M3 9h1.5m15 0H21m-1.5 6H21m-18 0h1.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 7.5h6v9H9v-9z" />
    </svg>
);

export const CrmIntegrationIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" />
    </svg>
);

export const CheckBadgeIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
);

export const CheckIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

export const StarIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.213-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.007z" clipRule="evenodd" />
  </svg>
);

export const PlusIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
);

export const MinusIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
    </svg>
);

export const ChevronDownIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
);

export const SearchIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
  </svg>
);

export const ArrowLeftIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
  </svg>
);

export const ArrowRightIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
  </svg>
);

export const XMarkIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
);

export const ChatBubbleLeftRightIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193l-3.72.372a3.75 3.75 0 0 1-3.653-3.653V15a3.75 3.75 0 0 1 3.75-3.75h5.25Zm-12 0c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193l-3.72.372a3.75 3.75 0 0 1-3.653-3.653V15a3.75 3.75 0 0 1 3.75-3.75h5.25Z" />
    </svg>
);

export const ClockIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
);

export const MinusCircleIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
);

export const LogoIcon: React.FC<IconProps> = (props) => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
    >
        <path
            d="M5 21V8.18182C5 6.09091 6.16667 5 8.5 5H19.5C20.8807 5 22 6.11929 22 7.5V16.5C22 17.8807 20.8807 19 19.5 19H8.5L5 21Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <path
            d="M9.5 12C10.5 10 11.5 10 12.5 12C13.5 14 14.5 14 15.5 12C16.5 10 17.5 10 18.5 12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

export const ChatBubbleOvalLeftEllipsisIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.455.09-.934.09-1.425 0-4.556 4.03-8.25 9-8.25 4.97 0 9 3.694 9 8.25Z" />
    </svg>
);

export const PaperAirplaneIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
    </svg>
);

export const ProfessionalAvatarIcon: React.FC<IconProps> = (props) => (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M12 12C13.6569 12 15 10.6569 15 9C15 7.34315 13.6569 6 12 6C10.3431 6 9 7.34315 9 9C9 10.6569 10.3431 12 12 12Z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M18 18.5C18 16.0147 15.3137 14 12 14C8.68629 14 6 16.0147 6 18.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
);

export const BellIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
  </svg>
);

export const Bars3Icon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );

export const LinkedInIcon: React.FC<IconProps> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.25 6.5 1.75 1.75 0 016.5 8.25zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93-1.14 0-1.62.91-1.62 2.05V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.38.93 3.38 4.22V19z" />
    </svg>
);

export const HandWavingIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.82m5.84-2.56a12.025 12.025 0 0 1-4.132 4.095m-4.132-4.095L10.5 21m-2.293-4.815a12.025 12.025 0 0 1-4.132-4.095m4.132 4.095L6.185 10.8m2.293 3.57a6 6 0 0 1-5.84-7.38V5.25a2.25 2.25 0 0 1 2.25-2.25h4.5a2.25 2.25 0 0 1 2.25 2.25v6.108a6 6 0 0 1-5.84 7.38z" />
  </svg>
);

export const LeafIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M11 20A7 7 0 0 1 4 13V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1"/>
    <path d="M15.21 18.21a7 7 0 0 1-1.21-10.21L12 2"/>
  </svg>
);

export const MicrophoneIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 0 1 6 0v8.25a3 3 0 0 1-3 3Z" />
  </svg>
);

export const TargetIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.599 8.401a3.6 3.6 0 1 0-7.2 0 3.6 3.6 0 0 0 7.2 0Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.6a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2Z" />
  </svg>
);

export const SunIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
  </svg>
);

export const MoonIcon: React.FC<IconProps> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
  </svg>
);

// Third party icons
export const CustomerSupportIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-1c0-.28.22-.5.5-.5h1c.28 0 .5.22.5.5v1c0 .28-.22.5-.5.5h-1c-.28 0-.5-.22-.5-.5zM8 12.5c0-.83.67-1.5 1.5-1.5h1V10c0-.55.45-1 1-1s1 .45 1 1v1h1c.83 0 1.5.67 1.5 1.5v2c0 .83-.67 1.5-1.5 1.5h-5C8.67 16 8 15.33 8 14.5v-2z" fill="#34A853"/></svg>);
export const ZoomIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}><path d="M14 6H4a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2V8a2 2 0 00-2-2zm-3.5 9l-3-2.25V15H6V9h1.5v2.25l3-2.25H12V15h-1.5zm8.5-7.5v9a1.5 1.5 0 01-3 0v-9a1.5 1.5 0 013 0z" fill="#2D8CFF"/></svg>);
export const NotionIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M14.5 4H6v16h1.5v-6.5h6V18H15V4h-.5zm-5 12.5V5.5H11v11h-1.5z"/></svg>);
export const GoogleIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}><path d="M21.35 11.1h-9.2v2.7h5.3c-.2 1.1-.9 2.1-2.1 2.8v1.8h2.3c1.9-1.8 3-4.3 3-7.3z" fill="#4285F4"/><path d="M12.15 21c2.4 0 4.5-.8 6-2.2l-2.3-1.8c-.8.5-1.8.9-3.1.9-2.4 0-4.5-1.6-5.2-3.8H4.2v1.9c1.4 2.8 4.2 4.8 7.95 4.8z" fill="#34A853"/><path d="M6.95 14.1c-.2-.6-.2-1.2-.2-1.8s0-1.2.2-1.8V8.6H4.2c-.7 1.4-1.1 3-1.1 4.7s.4 3.3 1.1 4.7l2.75-1.9z" fill="#FBBC05"/><path d="M12.15 6.9c1.1 0 2.2.4 3 1.2l2-2c-1.3-1.2-3-2-5-2-3.75 0-6.55 2-7.95 4.8l2.7 1.9c.7-2.2 2.8-3.8 5.25-3.8z" fill="#EA4335"/></svg>);
export const GmailIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}><path d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16z" fill="#EA4335"/><path d="M4 18V8l8 5 8-5v10H4z" fill="#C5221F"/></svg>);
export const GoogleCalendarIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}><path d="M21 5.25H3v13.5h18V5.25zM12 3v2.25M17.25 3v2.25M6.75 3v2.25" stroke="#4285F4" strokeWidth="1.5"/><path d="M3 7.5h18" stroke="#4285F4" strokeWidth="1.5"/><text x="12" y="16" fontFamily="sans-serif" fontSize="10" textAnchor="middle" fill="#212121">31</text></svg>);
export const GoogleCloudIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}><path d="M19.4 6.6C18.7 4.1 16.3 2 13.5 2 11.2 2 9.2 3.1 8.1 5c-2.9.4-5.1 2.8-5.1 5.8 0 3.2 2.6 5.8 5.8 5.8h11.2c2.8 0 5-2.2 5-5s-2.2-5-5-5h-1z" fill="#4285F4"/><path d="M8.1 5c-.4 2.1 1.2 4.1 3.4 4.5 2.2.4 4.3-.9 4.9-3 .6-2.1-1-4.1-3.2-4.5-1.1-.2-2.2.1-3.1 1z" fill="#FBBC05"/><path d="M19.4 6.6c.7 2.1-.4 4.3-2.5 5.1-2.1.7-4.3-.4-5.1-2.5s.4-4.3 2.5-5.1c1.2-.4 2.5-.2 3.5.7l1.6-1.2z" fill="#EA4335"/><path d="M3 10.8c-1.1 2 .2 4.4 2.5 5.2s4.9.2 6.1-1.8c-2.8-.5-4.8-2.9-4.8-5.8 0-1.1-.3-2.2-.8-3.1-.9.7-1.7 1.7-2 3.5z" fill="#34A853"/></svg>);
export const AppStoreIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#007AFF" {...props}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.04 14.5l-1.46-1.46L12 12.58l2.5-2.54 1.46 1.46L12 15.42l-1.04-1.06zm-3.46-5L6.04 10l5.96-5.96 1.46 1.46L7.5 11.5z"/></svg>);
export const SlackIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}><path d="M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" fill="#36C5F0"/><path d="M6.5 10a1.5 1.5 0 100 3h2v-3h-2z" fill="#2EB67D"/><path d="M8.5 12a1.5 1.5 0 103 0v-2h-3v2z" fill="#ECB22E"/><path d="M8.5 14a1.5 1.5 0 100 3v-3z" fill="#E01E5A"/><path d="M10.5 10.5a1.5 1.5 0 10-3 0h3z" fill="#ECB22E"/><path d="M8.5 12.5a1.5 1.5 0 100-3v3z" fill="#E01E5A"/><path d="M14.5 6.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" fill="#36C5F0"/><path d="M16.5 8.5a1.5 1.5 0 100-3h-2v3h2z" fill="#2EB67D"/><path d="M14.5 10.5a1.5 1.5 0 10-3 0v2h3v-2z" fill="#ECB22E"/><path d="M14.5 12.5a1.5 1.5 0 100-3v3z" fill="#E01E5A"/><path d="M12.5 8.5a1.5 1.5 0 103 0h-3z" fill="#2EB67D"/><path d="M14.5 10.5a1.5 1.5 0 100 3v-3z" fill="#36C5F0"/></svg>);
export const GoogleFormsIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#7E57C2" {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM9 18H7v-2h2v2zm4 0h-2v-2h2v2zm0-4h-6v-2h6v2zm2-4H7V8h8v2z"/></svg>);
export const GoogleSheetsIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#34A853" {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM9 18H7v-2h2v2zm4 0h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V8h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2z"/></svg>);
export const DiscordIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#5865F2" {...props}><path d="M20.3 4.43s-1.07-.7-2.1-.93a12.3 12.3 0 00-4.22.06c-1.3.3-2.5.86-3.6 1.63-.56.4-.9 1.1-.9 1.1s-1.1-1.4-3.2-1.8c-2.07-.4-4.2.3-4.2.3a14.2 14.2 0 005.1 11.8s2.2 1.8 4.6 1.8c2.4 0 4.6-1.8 4.6-1.8a14.2 14.2 0 005.1-11.8s-2.1-.7-4.1-.3zm-8.3 7.87c-.8 0-1.4-.6-1.4-1.4s.6-1.4 1.4-1.4 1.4.6 1.4 1.4-.6 1.4-1.4 1.4zm4 0c-.8 0-1.4-.6-1.4-1.4s.6-1.4 1.4-1.4 1.4.6 1.4 1.4-.6 1.4-1.4 1.4z"/></svg>);
export const BingIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="url(#bing-gradient)" {...props}><defs><linearGradient id="bing-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#F25022"/><stop offset="100%" stopColor="#FFB900"/></linearGradient></defs><path d="M13.2 2H4.8C3.2 2 2 3.2 2 4.8v8.4c0 .8.3 1.5.9 2.1l8.4 8.4c.6.6 1.4.9 2.1.9s1.5-.3 2.1-.9l4.2-4.2c.6-.6.9-1.4.9-2.1V12l-12-10z"/></svg>);
export const HubspotIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#FF7A59" {...props}><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-2.5 13.5l5-2.5-2.5-5-5 2.5 2.5 5z"/></svg>);
export const VercelIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 2L2 22h20L12 2z"/></svg>);
export const PythonIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}><path d="M15 6a2 2 0 100-4 2 2 0 000 4z" fill="#FFD43B"/><path d="M9 18a2 2 0 100 4 2 2 0 000-4z" fill="#306998"/><path d="M15 8h-4.3c-1.3 0-2.6.8-3.1 2L5 15.3c-1.1 2.3 1 5 3.5 4.5l6.7-1.4c2-.4 3.3-2.3 2.9-4.3l-1.4-6.7c-.2-1.1-1.2-1.9-2.4-1.9z" fill="#306998"/><path d="M10.7 18.2L9 15.1l2.6-5.2h1.8l-1.4 6.7c-.1 1.1-.9 1.9-2 1.9h-.4c-.1 0-.3 0-.3-.3z" fill="#FFD43B"/></svg>);
export const FigmaIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}><path d="M15 9a3 3 0 10-6 0 3 3 0 006 0z" fill="#F24E1E"/><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" fill="#FF7262"/><path d="M9 15a3 3 0 100 6 3 3 0 000-6z" fill="#A259FF"/><path d="M15 15a3 3 0 100 6 3 3 0 000-6z" fill="#1ABCFE"/><path d="M12 9a3 3 0 100-6 3 3 0 000 6z" fill="#0ACF83"/></svg>);
export const DatabaseIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#A259FF" {...props}><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/></svg>);
export const ShopifyIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#96BF48" {...props}><path d="M19.1 8.3c-1-1.7-2.9-2.8-5.1-2.8h-4c-.4 0-.8.3-.8.8v8.9c0 .4.3.8.8.8h2.8c1.7 0 3.2-1 4.1-2.4l1.3-2.2c.4-.7.4-1.5 0-2.1zM9.3 7.3h2.8c.6 0 1.2.2 1.6.6.4.4.7.9.7 1.5s-.2 1.1-.7 1.5c-.4.4-1 .6-1.6.6H9.3V7.3zm4.5 7.8c-.4.4-1 .6-1.6.6h-1v-4.1h1c.6 0 1.2.2 1.6.6.4.4.7.9.7 1.5s-.3 1.1-.7 1.4z"/></svg>);
export const ZendeskIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#03363D" {...props}><path d="M4 4h16v8H4V4zm0 10h8v6H4v-6zm10 0h6v6h-6v-6z"/></svg>);
export const CoinbaseIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#0052FF" {...props}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-4h2v4zm4 0h-2v-4h2v4zm-2-6h-2V8h2v2z"/></svg>);
export const OpenAiIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.5 13.5l-3-1.73V8.23l3 1.73v7.04zm3-7.5l-3-1.73L12 4.5l3 1.73-1.5 2.27zM15 15.23l-3-1.73V10l3 1.73v3.5z"/></svg>);
export const SalesforceIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#00A1E0" {...props}><path d="M16 11c0-3-2-5-5-5-3.6 0-5.7 3.1-6.2 5.2-2 .5-3.3 2.1-3.3 4.3 0 2.5 2 4.5 4.5 4.5h8.9c2.3 0 4.1-1.8 4.1-4.1 0-2-1.4-3.6-3.3-4-1.1-.3-1.7-1.3-1.7-2.4z"/></svg>);
export const LinearIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="url(#linear-gradient)" {...props}><defs><linearGradient id="linear-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#5E6AD2"/><stop offset="100%" stopColor="#A259FF"/></linearGradient></defs><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 18a8 8 0 110-16 8 8 0 010 16zm-4-4h8v-2H8v2zm0-4h8V8H8v2z"/></svg>);
export const WhatsappIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#25D366" {...props}><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.9c0 1.7.4 3.4 1.2 4.9L2 22l5.3-1.4c1.5.7 3.1 1.1 4.7 1.1h.01c5.46 0 9.9-4.45 9.9-9.9C21.94 6.45 17.5 2 12.04 2zM9.5 16.1l-2.6-2.6 1.2-1.2 1.4 1.4 3-3 1.2 1.2-4.2 4.2z"/></svg>);
export const SnowflakeIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#29B5E8" {...props}><path d="M12 2l2.1 6.3H21l-5.4 3.9 2.1 6.3L12 14.6l-5.7 3.9 2.1-6.3L3 8.3h6.9L12 2z"/></svg>);
export const ShareIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/></svg>);
export const GeminiIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#8E75B5" xmlns="http://www.w3.org/2000/svg" {...props}><path d="M12 2.5C12 2.5 12.5 5.5 14 6.5C15.5 7.5 18.5 8 18.5 8C18.5 8 15.5 8.5 14 9.5C12.5 10.5 12 13.5 12 13.5C12 13.5 11.5 10.5 10 9.5C8.5 8.5 5.5 8 5.5 8C5.5 8 8.5 7.5 10 6.5C11.5 5.5 12 2.5 12 2.5Z"/><path d="M18 12.5C18 12.5 17 14.5 16 15C15 15.5 13 16 13 16C13 16 15 16.5 16 17C17 17.5 18 19.5 18 19.5C18 19.5 19 17.5 20 17C21 16.5 23 16 23 16C23 16 21 15.5 20 15C19 14.5 18 12.5 18 12.5Z"/><path d="M6 12.5C6 12.5 7 14.5 8 15C9 15.5 11 16 11 16C11 16 9 16.5 8 17C7 17.5 6 19.5 6 19.5C6 19.5 5 17.5 4 17C3 16.5 1 16 1 16C1 16 3 15.5 4 15C5 14.5 6 12.5 6 12.5Z"/></svg>);
export const ReplicateIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#007AFF" {...props}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9v-2h2v2zm0-4H9V8h2v4zm4 4h-2v-2h2v2zm0-4h-2V8h2v4z"/></svg>);
export const FigJamIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}><circle cx="6" cy="18" r="3" fill="#F24E1E"/><circle cx="12" cy="14" r="4" fill="#A259FF"/><circle cx="18" cy="10" r="3" fill="#0ACF83"/><path d="M9 7a3 3 0 10-6 0 3 3 0 006 0z" fill="#FF7262"/></svg>);
export const AirtableIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}><path d="M3 12l9-9 9 9-9 9-9-9z" fill="#FFC940"/><path d="M12 5.5L6.5 12l5.5 5.5V5.5z" fill="#4D80F7"/></svg>);
export const TeamsIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#464EB8" {...props}><path d="M14 8a2 2 0 100-4 2 2 0 000 4zm-6 2a2 2 0 100-4 2 2 0 000 4zm-1 6h8v-2h-8v2zm8.5-5H18v-2h-2.5v2zM5 16h1.5v-2H5v2zm8-5c-2.2 0-4 1.8-4 4v2h8v-2c0-2.2-1.8-4-4-4z"/></svg>);
export const MetaIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#0085FF" {...props}><path d="M22 12c0-5.5-4.5-10-10-10S2 6.5 2 12c0 4.9 3.5 8.9 8 9.8V15H8v-3h2V9.5C10 7.6 11.1 6 13.2 6c.9 0 1.8.2 1.8.2v2.6h-1.3c-1 0-1.7.8-1.7 1.7V12h3l-.4 3h-2.6v6.8c4.5-1 8-5 8-9.8z"/></svg>);
export const ConfluenceIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#172B4D" {...props}><path d="M11.2 2.3L2 12l9.2 9.7L20.4 12 11.2 2.3zm0 13.2l-3.7-3.7 3.7-3.7 3.7 3.7-3.7 3.7z"/></svg>);
export const JiraIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#0052CC" {...props}><path d="M12 2L2 12l10 10 10-10L12 2zm-1.5 14.5L5 11l5.5-5.5 5.5 5.5-5.5 5.5z"/></svg>);
export const AzureIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#0078D4" {...props}><path d="M13.5 3L3 14h7.5l-1 8 11.5-12H13.5l1-7z"/></svg>);
export const OutlookIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#0078D4" {...props}><path d="M21 5H3a2 2 0 00-2 2v10a2 2 0 002 2h18a2 2 0 002-2V7a2 2 0 00-2-2zm-2 12H5V9h14v8zm-7-5l-5-3h10l-5 3z"/></svg>);
export const MailchimpIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#000000" {...props}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.5 12.8c-.5.6-1.2.9-2 .9s-1.5-.3-2-.9c-.8-.9-1-2.1-.7-3.2.3-1.1 1.2-2 2.4-2.3.5-.1 1-.1 1.5 0 1.2.3 2.1 1.2 2.4 2.3.3 1.1.1 2.3-.6 3.2zm-4.1-1.4c-.3.4-.3.9 0 1.3.4.4.9.4 1.3 0 .4-.4.4-.9 0-1.3-.5-.4-1-.4-1.3 0zm-2.1-1.3c-.6-.7-1-1.7-.8-2.7.2-.9.9-1.7 1.8-2 .7-.2 1.4-.1 2.1.3-.4.8-.6 1.6-.6 2.5 0 1.3.7 2.5 1.7 3.2-.3.1-.6.2-.9.2-1.9 0-3.5-1.6-3.5-3.5z"/></svg>);
export const StripeIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#635BFF" {...props}><path d="M10.1 4H4v16h6.1c3.5 0 6.4-2.9 6.4-6.4v-3.2c0-3.5-2.9-6.4-6.4-6.4zm0 11.9H8.2V8.1h1.9c1.6 0 2.9 1.3 2.9 2.9v2.2c0 1.6-1.3 2.9-2.9 2.9zm6.4-11.9H20v16h-3.5v-6.9H14v-2.2h2.5V4z"/></svg>);
export const IntercomIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#1F8DFF" {...props}><path d="M19 3H5a2 2 0 00-2 2v10a2 2 0 002 2h3.59L12 20.42 15.41 17H19a2 2 0 002-2V5a2 2 0 00-2-2z"/></svg>);
export const TrelloIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#0079BF" {...props}><path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM11 17H7v-8h4v8zm6 0h-4v-5h4v5z"/></svg>);


// Unused but kept for potential future use
export const AsanaIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="#F06A6A" {...props}><path d="M12 9.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm0 9.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm-6-4.75a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/></svg>);
export const GoogleDocsIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>);
export const ZapierIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M3 12h6v-2H3v2zm6 2h12v-2H9v2zm-6 2h6v-2H3v2zm12-12v2h6V4h-6zm-6 2h6V4H9v2z"/></svg>);
export const GoogleMeetIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M17 10.5V7c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h10c1.1 0 2-1.1 2-1.9V13.5l4 4V6.5l-4 4z"/></svg>);
export const GoogleDriveIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M7.71 3.5l7.07 12.25L22 15.65l-7.07-12.25H7.71zM8.33 4.5l-6 10.38L8.88 20l6-10.38L8.33 4.5zM15.5 16.5l-6.5 4L2 14l6.5-4 7 0z"/></svg>);
export const EuroIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M15 20c-4.4 0-8-3.6-8-8s3.6-8 8-8v2c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6h2c0 4.4-3.6 8-8 8zM5 11h8v2H5v-2z"/></svg>);
export const GitIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M22 10.5v-1l-6-6-1 1 5 5h-7.5a4.5 4.5 0 00-4.5 4.5v5h2v-5a2.5 2.5 0 012.5-2.5H15l-5 5-1 1 6 6 1-1-5-5 5-5zM6 6a2 2 0 100-4 2 2 0 000 4zm0 16a2 2 0 100-4 2 2 0 000 4zm12-8a2 2 0 100-4 2 2 0 000 4z"/></svg>);
export const AtlassianIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M11.2 2.3L2 12l9.2 9.7L20.4 12 11.2 2.3zm0 13.2l-3.7-3.7 3.7-3.7 3.7 3.7-3.7 3.7z"/></svg>);
export const WebflowIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 2L2 7v10l10 5 10-5V7L12 2zm-1 14.9V7.1l6-3.4v10.8l-6 3.4z"/></svg>);
export const FramerIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M4 4h16v8h-8zM4 12h8v8H4z"/></svg>);
export const AnalyticsIcon: React.FC<IconProps> = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zm0-10V7h14v2H7z"/></svg>);