// Template registry — preset configurations for common business types

import { TemplateConfig } from './types';

export const TEMPLATES: TemplateConfig[] = [
  {
    id: 'home-services',
    name: 'Home Services',
    description: 'Contractors, plumbers, electricians, HVAC, cleaning, landscaping',
    icon: 'Hammer',
    businessTypes: ['contractor', 'plumber', 'electrician', 'hvac', 'cleaning', 'landscaping', 'roofing', 'painting', 'remodeling', 'handyman'],
    defaultServices: [
      { name: 'Residential Services', description: 'Professional home services tailored to your needs. Quality workmanship with attention to every detail.', icon: 'Home' },
      { name: 'Commercial Services', description: 'Reliable commercial solutions for businesses of all sizes. Minimize downtime, maximize results.', icon: 'Building2' },
      { name: 'Emergency Services', description: '24/7 emergency response when you need it most. Fast arrival, professional solutions.', icon: 'Zap' },
      { name: 'Maintenance Plans', description: 'Preventive maintenance programs to keep everything running smoothly year-round.', icon: 'Wrench' },
      { name: 'Free Estimates', description: 'Transparent pricing with no hidden fees. Get a detailed estimate before any work begins.', icon: 'Calculator' },
      { name: 'Licensed & Insured', description: 'Fully licensed and insured professionals. Your property is protected with every job.', icon: 'ShieldCheck' },
    ],
    defaultPages: ['home', 'about', 'services', 'gallery', 'reviews', 'contact', 'faq'],
    colorSchemes: [
      { name: 'Professional Blue', primary: '#2563eb', secondary: '#1e40af', accent: '#3b82f6' },
      { name: 'Trust Green', primary: '#059669', secondary: '#047857', accent: '#10b981' },
      { name: 'Bold Red', primary: '#dc2626', secondary: '#b91c1c', accent: '#ef4444' },
      { name: 'Modern Dark', primary: '#374151', secondary: '#1f2937', accent: '#6b7280' },
      { name: 'Warm Orange', primary: '#ea580c', secondary: '#c2410c', accent: '#f97316' },
    ],
    sections: ['hero', 'services', 'about', 'gallery', 'reviews', 'contact', 'faq'],
  },
  {
    id: 'medical-dental',
    name: 'Medical & Dental',
    description: 'Dentists, doctors, clinics, med spas, chiropractors',
    icon: 'Stethoscope',
    businessTypes: ['dentist', 'doctor', 'clinic', 'medspa', 'chiropractor', 'optometrist', 'dermatology', 'pediatric', 'urgent-care'],
    defaultServices: [
      { name: 'General Dentistry', description: 'Comprehensive dental care including cleanings, fillings, and preventive treatments for the whole family.', icon: 'Heart' },
      { name: 'Cosmetic Dentistry', description: 'Transform your smile with veneers, whitening, bonding, and other cosmetic procedures.', icon: 'Sparkles' },
      { name: 'Dental Implants', description: 'Permanent tooth replacement solutions that look, feel, and function like natural teeth.', icon: 'Shield' },
      { name: 'Emergency Care', description: 'Same-day emergency appointments available. Tooth pain, broken teeth — we are here to help.', icon: 'Zap' },
      { name: 'Orthodontics', description: 'Straighten your smile with modern orthodontic options including clear aligners and traditional braces.', icon: 'Smile' },
      { name: 'Pediatric Care', description: 'Gentle, kid-friendly dental care in a comfortable environment. Building healthy habits early.', icon: 'Baby' },
    ],
    defaultPages: ['home', 'about', 'services', 'reviews', 'contact', 'faq'],
    colorSchemes: [
      { name: 'Clean Blue', primary: '#0284c7', secondary: '#0369a1', accent: '#38bdf8' },
      { name: 'Calming Teal', primary: '#0d9488', secondary: '#0f766e', accent: '#2dd4bf' },
      { name: 'Professional Navy', primary: '#1e3a5f', secondary: '#172554', accent: '#3b82f6' },
      { name: 'Soft Green', primary: '#16a34a', secondary: '#15803d', accent: '#4ade80' },
      { name: 'Modern Purple', primary: '#7c3aed', secondary: '#6d28d9', accent: '#a78bfa' },
    ],
    sections: ['hero', 'services', 'about', 'reviews', 'contact', 'faq'],
  },
  {
    id: 'restaurant-food',
    name: 'Restaurant & Food',
    description: 'Restaurants, cafes, food trucks, catering, bakeries',
    icon: 'UtensilsCrossed',
    businessTypes: ['restaurant', 'cafe', 'food-truck', 'catering', 'bakery', 'bar', 'pizza', 'sushi', 'bbq', 'ice-cream', 'coffee-shop'],
    defaultServices: [
      { name: 'Dine-In', description: 'Enjoy a warm, welcoming atmosphere with exceptional food and attentive service.', icon: 'UtensilsCrossed' },
      { name: 'Takeout', description: 'Quick and convenient takeout. Order ahead and pick up your favorites in minutes.', icon: 'ShoppingBag' },
      { name: 'Catering', description: 'Full-service catering for events of any size. Custom menus tailored to your occasion.', icon: 'Users' },
      { name: 'Online Ordering', description: 'Browse our menu and order online for pickup or delivery. Fresh food, fast service.', icon: 'Monitor' },
      { name: 'Private Events', description: 'Host your special occasion in our private dining area. Perfect for parties and celebrations.', icon: 'Calendar' },
      { name: 'Daily Specials', description: 'New specials every day featuring seasonal ingredients and chef favorites.', icon: 'Star' },
    ],
    defaultPages: ['home', 'about', 'contact', 'reviews'],
    colorSchemes: [
      { name: 'Warm Red', primary: '#b91c1c', secondary: '#991b1b', accent: '#f87171' },
      { name: 'Rich Burgundy', primary: '#7f1d1d', secondary: '#6b1c1c', accent: '#dc2626' },
      { name: 'Elegant Gold', primary: '#92400e', secondary: '#78350f', accent: '#f59e0b' },
      { name: 'Fresh Green', primary: '#15803d', secondary: '#166534', accent: '#4ade80' },
      { name: 'Modern Black', primary: '#18181b', secondary: '#09090b', accent: '#a1a1aa' },
    ],
    sections: ['hero', 'services', 'about', 'reviews', 'contact'],
  },
  {
    id: 'professional-services',
    name: 'Professional Services',
    description: 'Law firms, accountants, real estate, insurance, consultants',
    icon: 'Briefcase',
    businessTypes: ['lawyer', 'attorney', 'accountant', 'real-estate', 'insurance', 'consultant', 'financial-advisor', 'tax-preparer', 'notary'],
    defaultServices: [
      { name: 'Consultation', description: 'Expert advice tailored to your specific situation. We listen first, then provide solutions.', icon: 'MessageCircle' },
      { name: 'Full-Service Support', description: 'End-to-end professional support from initial assessment through final resolution.', icon: 'CheckCircle' },
      { name: 'Compliance & Documentation', description: 'Stay compliant with all regulations. We handle the paperwork so you can focus on what matters.', icon: 'FileText' },
      { name: 'Strategic Planning', description: 'Long-term planning and strategy to help you achieve your goals and protect your interests.', icon: 'Target' },
      { name: 'Emergency Response', description: 'Time-sensitive matters handled with urgency and precision. Available when you need us.', icon: 'Zap' },
      { name: 'Free Initial Review', description: 'No-obligation initial consultation to understand your needs and outline your options.', icon: 'Award' },
    ],
    defaultPages: ['home', 'about', 'services', 'reviews', 'contact', 'faq'],
    colorSchemes: [
      { name: 'Navy Trust', primary: '#1e3a5f', secondary: '#172554', accent: '#3b82f6' },
      { name: 'Dark Professional', primary: '#1c1917', secondary: '#0c0a09', accent: '#78716c' },
      { name: 'Authoritative Blue', primary: '#1d4ed8', secondary: '#1e40af', accent: '#60a5fa' },
      { name: 'Forest Green', primary: '#166534', secondary: '#14532d', accent: '#4ade80' },
      { name: 'Burgundy Authority', primary: '#881337', secondary: '#701a30', accent: '#f43f5e' },
    ],
    sections: ['hero', 'services', 'about', 'reviews', 'contact', 'faq'],
  },
  {
    id: 'fitness-wellness',
    name: 'Fitness & Wellness',
    description: 'Gyms, personal trainers, yoga studios, spas, salons',
    icon: 'Dumbbell',
    businessTypes: ['gym', 'personal-trainer', 'yoga', 'spa', 'salon', 'massage', 'pilates', 'crossfit', 'wellness'],
    defaultServices: [
      { name: 'Personal Training', description: 'One-on-one training sessions customized to your fitness level, goals, and schedule.', icon: 'User' },
      { name: 'Group Classes', description: 'Energetic group fitness classes for all levels. Find your community and your motivation.', icon: 'Users' },
      { name: 'Nutrition Coaching', description: 'Personalized nutrition plans to complement your training and maximize your results.', icon: 'Heart' },
      { name: 'Wellness Services', description: 'Recovery, massage, and holistic wellness services to keep your body performing at its best.', icon: 'Sparkles' },
      { name: 'Online Programs', description: 'Train from anywhere with our library of on-demand workouts and live virtual classes.', icon: 'Monitor' },
      { name: 'Free Trial', description: 'Experience everything we offer with a complimentary trial session. No commitment required.', icon: 'Gift' },
    ],
    defaultPages: ['home', 'about', 'services', 'gallery', 'reviews', 'contact'],
    colorSchemes: [
      { name: 'Energy Orange', primary: '#ea580c', secondary: '#c2410c', accent: '#fb923c' },
      { name: 'Power Red', primary: '#dc2626', secondary: '#b91c1c', accent: '#f87171' },
      { name: 'Fresh Green', primary: '#16a34a', secondary: '#15803d', accent: '#4ade80' },
      { name: 'Bold Purple', primary: '#7c3aed', secondary: '#6d28d9', accent: '#a78bfa' },
      { name: 'Dark Motivation', primary: '#18181b', secondary: '#09090b', accent: '#f97316' },
    ],
    sections: ['hero', 'services', 'about', 'gallery', 'reviews', 'contact'],
  },
  {
    id: 'auto-services',
    name: 'Auto Services',
    description: 'Mechanics, auto body, car wash, detailing, tire shops',
    icon: 'Car',
    businessTypes: ['mechanic', 'auto-body', 'car-wash', 'detailing', 'tire-shop', 'oil-change', 'transmission', 'auto-glass', 'towing'],
    defaultServices: [
      { name: 'General Repairs', description: 'Comprehensive auto repair services for all makes and models. Honest diagnostics, fair pricing.', icon: 'Wrench' },
      { name: 'Maintenance', description: 'Regular maintenance to keep your vehicle running at peak performance. Oil changes, filters, fluids, and more.', icon: 'Settings' },
      { name: 'Diagnostics', description: 'Advanced computer diagnostics to identify issues quickly and accurately. No guesswork.', icon: 'Search' },
      { name: 'Body Work', description: 'Collision repair, dent removal, and paint restoration. We make your car look new again.', icon: 'PaintBucket' },
      { name: 'Tires & Alignment', description: 'Tire sales, mounting, balancing, and wheel alignment. The right tires for your driving needs.', icon: 'Circle' },
      { name: 'Fleet Services', description: 'Commercial fleet maintenance programs to keep your business vehicles on the road.', icon: 'Truck' },
    ],
    defaultPages: ['home', 'about', 'services', 'reviews', 'contact', 'faq'],
    colorSchemes: [
      { name: 'Garage Red', primary: '#dc2626', secondary: '#b91c1c', accent: '#f87171' },
      { name: 'Mechanic Blue', primary: '#2563eb', secondary: '#1d4ed8', accent: '#60a5fa' },
      { name: 'Industrial Gray', primary: '#374151', secondary: '#1f2937', accent: '#9ca3af' },
      { name: 'Racing Orange', primary: '#ea580c', secondary: '#c2410c', accent: '#fb923c' },
      { name: 'Black & Yellow', primary: '#854d0e', secondary: '#713f12', accent: '#facc15' },
    ],
    sections: ['hero', 'services', 'about', 'reviews', 'contact', 'faq'],
  },
];

export function getTemplateById(id: string): TemplateConfig | undefined {
  return TEMPLATES.find(t => t.id === id);
}

export function getTemplateForBusinessType(businessType: string): TemplateConfig | undefined {
  const normalized = businessType.toLowerCase().trim();
  return TEMPLATES.find(t =>
    t.businessTypes.some(bt => normalized.includes(bt) || bt.includes(normalized))
  );
}
