// Shared base components — Header, Footer, Layout used by ALL templates

import { BusinessInfo } from './types';

export function generateIndexHtml(info: BusinessInfo): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${info.businessName} | ${info.tagline}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              primary: '${info.primaryColor}',
              secondary: '${info.secondaryColor}',
            },
            fontFamily: {
              sans: ['Inter', 'system-ui', 'sans-serif'],
            }
          }
        }
      }
    </script>
    <style>
      *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
}

export function generateStyles(): string {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-white text-gray-900 antialiased;
  }
}

@layer utilities {
  .text-balance {
    text-wrap: balance;
  }
}`;
}

export function generateUtils(): string {
  return `import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}`;
}

export function generateHeader(info: BusinessInfo): string {
  return `import React, { useState } from 'react';
import { Menu, X, Phone } from 'lucide-react';

const NAV_LINKS = [
  { label: 'Home', href: '#home' },
  { label: 'Services', href: '#services' },
  { label: 'About', href: '#about' },
  { label: 'Gallery', href: '#gallery' },
  { label: 'Reviews', href: '#reviews' },
  { label: 'Contact', href: '#contact' },
];

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 lg:h-20">
          {/* Logo */}
          <a href="#home" className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg" style={{ background: '${info.primaryColor}' }}>
              ${info.businessName.charAt(0)}
            </div>
            <span className="text-xl font-bold text-gray-900">${info.businessName}</span>
          </a>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* CTA + Phone */}
          <div className="hidden lg:flex items-center gap-4">
            <a href="tel:${info.phone}" className="flex items-center gap-2 text-sm font-semibold" style={{ color: '${info.primaryColor}' }}>
              <Phone className="w-4 h-4" />
              ${info.phone}
            </a>
            <a
              href="#contact"
              className="px-5 py-2.5 rounded-lg text-white text-sm font-semibold transition-all hover:opacity-90 shadow-lg shadow-black/10"
              style={{ background: '${info.primaryColor}' }}
            >
              Get a Quote
            </a>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isOpen && (
          <div className="lg:hidden pb-4 border-t border-gray-100 mt-2 pt-4">
            <nav className="flex flex-col gap-2">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className="px-3 py-2 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors font-medium"
                >
                  {link.label}
                </a>
              ))}
              <a
                href="tel:${info.phone}"
                className="flex items-center gap-2 px-3 py-2 font-semibold"
                style={{ color: '${info.primaryColor}' }}
              >
                <Phone className="w-4 h-4" />
                ${info.phone}
              </a>
              <a
                href="#contact"
                onClick={() => setIsOpen(false)}
                className="mt-2 px-5 py-3 rounded-lg text-white text-center font-semibold"
                style={{ background: '${info.primaryColor}' }}
              >
                Get a Quote
              </a>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}`;
}

export function generateFooter(info: BusinessInfo): string {
  const serviceLinks = info.services
    .slice(0, 6)
    .map(s => `            <li><a href="#services" className="text-gray-400 hover:text-white transition-colors text-sm">${s.name}</a></li>`)
    .join('\n');

  return `import React from 'react';
import { Phone, Mail, MapPin } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-white pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
          {/* About */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg" style={{ background: '${info.primaryColor}' }}>
                ${info.businessName.charAt(0)}
              </div>
              <span className="text-xl font-bold">${info.businessName}</span>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              ${info.description.length > 150 ? info.description.substring(0, 150) + '...' : info.description}
            </p>
          </div>

          {/* Services */}
          <div>
            <h3 className="font-semibold text-lg mb-4">Our Services</h3>
            <ul className="space-y-2">
${serviceLinks}
            </ul>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold text-lg mb-4">Quick Links</h3>
            <ul className="space-y-2">
              <li><a href="#home" className="text-gray-400 hover:text-white transition-colors text-sm">Home</a></li>
              <li><a href="#about" className="text-gray-400 hover:text-white transition-colors text-sm">About Us</a></li>
              <li><a href="#services" className="text-gray-400 hover:text-white transition-colors text-sm">Services</a></li>
              <li><a href="#gallery" className="text-gray-400 hover:text-white transition-colors text-sm">Gallery</a></li>
              <li><a href="#reviews" className="text-gray-400 hover:text-white transition-colors text-sm">Reviews</a></li>
              <li><a href="#contact" className="text-gray-400 hover:text-white transition-colors text-sm">Contact</a></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-semibold text-lg mb-4">Contact Us</h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                <span className="text-gray-400 text-sm">${info.address}, ${info.city}, ${info.state}</span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-gray-400" />
                <a href="tel:${info.phone}" className="text-gray-400 hover:text-white transition-colors text-sm">${info.phone}</a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-gray-400" />
                <a href="mailto:${info.email}" className="text-gray-400 hover:text-white transition-colors text-sm">${info.email}</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-gray-500 text-sm">
            &copy; {new Date().getFullYear()} ${info.businessName}. All rights reserved.
          </p>
          <p className="text-gray-600 text-xs">
            Powered by Antigravity Digital
          </p>
        </div>
      </div>
    </footer>
  );
}`;
}
