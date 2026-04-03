// Template system types

export interface BusinessInfo {
  businessName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  primaryColor: string;
  secondaryColor: string;
  tagline: string;
  description: string;
  services: ServiceInfo[];
  pages: string[];
}

export interface ServiceInfo {
  name: string;
  description: string;
  icon: string; // lucide-react icon name
}

export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon for the picker UI
  businessTypes: string[]; // which business types this fits
  defaultServices: ServiceInfo[];
  defaultPages: string[];
  colorSchemes: ColorScheme[];
  sections: string[]; // which section components to include
}

export interface ColorScheme {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
}

export type FileGenerator = (info: BusinessInfo) => string;
