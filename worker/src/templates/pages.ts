// Page templates — Hero, Services, About, Contact, Gallery, Reviews, FAQ

import { BusinessInfo } from './types';

export function generateHero(info: BusinessInfo): string {
  return `import React from 'react';
import { ArrowRight, Star, Shield, Clock } from 'lucide-react';

export default function Hero() {
  return (
    <section id="home" className="relative min-h-screen flex items-center pt-20">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-50 via-white to-gray-100" />
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23000000\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div className="space-y-8">
            {/* Trust Badges */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200">
                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                <span className="text-sm font-medium text-amber-700">5-Star Rated</span>
              </div>
              <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-green-50 border border-green-200">
                <Shield className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium text-green-700">Licensed & Insured</span>
              </div>
              <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200">
                <Clock className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-700">Same-Day Service</span>
              </div>
            </div>

            {/* Headline */}
            <div className="space-y-4">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-gray-900 leading-[1.1] tracking-tight">
                ${info.tagline}
              </h1>
              <p className="text-lg sm:text-xl text-gray-600 leading-relaxed max-w-xl">
                ${info.description.length > 200 ? info.description.substring(0, 200) + '...' : info.description}
              </p>
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4">
              <a
                href="#contact"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-white font-semibold text-lg transition-all hover:opacity-90 shadow-xl shadow-black/10"
                style={{ background: '${info.primaryColor}' }}
              >
                Get Your Free Quote
                <ArrowRight className="w-5 h-5" />
              </a>
              <a
                href="tel:${info.phone}"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl border-2 border-gray-200 text-gray-700 font-semibold text-lg hover:border-gray-300 hover:bg-gray-50 transition-all"
              >
                Call ${info.phone}
              </a>
            </div>

            {/* Social Proof */}
            <div className="flex items-center gap-4 pt-2">
              <div className="flex -space-x-2">
                {[1,2,3,4].map(i => (
                  <div key={i} className="w-10 h-10 rounded-full border-2 border-white flex items-center justify-center text-xs font-bold text-white" style={{ background: '${info.primaryColor}', opacity: 1 - i * 0.15 }}>
                    {String.fromCharCode(64 + i)}
                  </div>
                ))}
              </div>
              <div>
                <div className="flex items-center gap-1">
                  {[1,2,3,4,5].map(i => (
                    <Star key={i} className="w-4 h-4 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-gray-500 mt-0.5">Trusted by 500+ happy customers</p>
              </div>
            </div>
          </div>

          {/* Right — Hero Image Placeholder */}
          <div className="relative hidden lg:block">
            <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-gray-200 shadow-2xl">
              <img
                src="FAL_IMAGE[professional photo of ${info.businessName.toLowerCase()} team working, clean modern environment, warm lighting, high quality commercial photography]"
                alt="${info.businessName} at work"
                className="w-full h-full object-cover"
              />
            </div>
            {/* Floating Card */}
            <div className="absolute -bottom-6 -left-6 bg-white rounded-xl shadow-xl p-4 border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white" style={{ background: '${info.primaryColor}' }}>
                  <Shield className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">100% Satisfaction</p>
                  <p className="text-sm text-gray-500">Guaranteed results</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}`;
}

export function generateServices(info: BusinessInfo): string {
  const serviceCards = info.services.map((service, i) => {
    return `            {/* ${service.name} */}
            <div className="group p-6 rounded-2xl border border-gray-100 bg-white hover:shadow-xl hover:shadow-black/5 transition-all duration-300 hover:-translate-y-1">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-4 transition-colors" style={{ background: '${info.primaryColor}15' }}>
                <${service.icon} className="w-7 h-7" style={{ color: '${info.primaryColor}' }} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">${service.name}</h3>
              <p className="text-gray-600 leading-relaxed">${service.description}</p>
              <a href="#contact" className="inline-flex items-center gap-1 mt-4 text-sm font-semibold transition-colors" style={{ color: '${info.primaryColor}' }}>
                Learn More
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>`;
  }).join('\n');

  const iconImports = [...new Set(info.services.map(s => s.icon))].join(', ');

  return `import React from 'react';
import { ${iconImports}, ArrowRight } from 'lucide-react';

export default function Services() {
  return (
    <section id="services" className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: '${info.primaryColor}' }}>What We Do</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">Our Services</h2>
          <p className="text-lg text-gray-600">Professional solutions tailored to your needs. We deliver quality results every time.</p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
${serviceCards}
        </div>

        {/* CTA */}
        <div className="text-center mt-12">
          <a
            href="#contact"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl text-white font-semibold text-lg transition-all hover:opacity-90 shadow-lg"
            style={{ background: '${info.primaryColor}' }}
          >
            Get Started Today
            <ArrowRight className="w-5 h-5" />
          </a>
        </div>
      </div>
    </section>
  );
}`;
}

export function generateAbout(info: BusinessInfo): string {
  return `import React from 'react';
import { CheckCircle, Award, Users, Clock } from 'lucide-react';

const STATS = [
  { icon: Award, value: '10+', label: 'Years Experience' },
  { icon: Users, value: '500+', label: 'Happy Customers' },
  { icon: CheckCircle, value: '1000+', label: 'Projects Completed' },
  { icon: Clock, value: '24/7', label: 'Support Available' },
];

export default function About() {
  return (
    <section id="about" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Image */}
          <div className="relative">
            <div className="aspect-square rounded-2xl overflow-hidden bg-gray-200 shadow-2xl">
              <img
                src="FAL_IMAGE[interior of modern ${info.businessName.toLowerCase()} business, professional workspace, clean and organized, warm commercial photography]"
                alt="About ${info.businessName}"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="absolute -bottom-6 -right-6 bg-white rounded-xl shadow-xl p-6 border border-gray-100">
              <p className="text-4xl font-extrabold" style={{ color: '${info.primaryColor}' }}>10+</p>
              <p className="text-sm text-gray-500 mt-1">Years of Excellence</p>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-6">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: '${info.primaryColor}' }}>About Us</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
                ${info.businessName} — ${info.city}'s Trusted Choice
              </h2>
              <p className="text-lg text-gray-600 leading-relaxed">
                ${info.description}
              </p>
            </div>

            <div className="space-y-3">
              {['Licensed & insured professionals', 'Transparent pricing, no hidden fees', 'Fast response times', 'Satisfaction guaranteed'].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 shrink-0" style={{ color: '${info.primaryColor}' }} />
                  <span className="text-gray-700">{item}</span>
                </div>
              ))}
            </div>

            <a
              href="#contact"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-white font-semibold transition-all hover:opacity-90"
              style={{ background: '${info.primaryColor}' }}
            >
              Learn More About Us
            </a>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mt-20">
          {STATS.map((stat, i) => (
            <div key={i} className="text-center p-6 rounded-2xl bg-gray-50">
              <stat.icon className="w-8 h-8 mx-auto mb-3" style={{ color: '${info.primaryColor}' }} />
              <p className="text-3xl font-extrabold text-gray-900">{stat.value}</p>
              <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}`;
}

export function generateGallery(_info: BusinessInfo): string {
  return `import React, { useState } from 'react';

const CATEGORIES = ['All', 'Residential', 'Commercial', 'Before & After'];

export default function Gallery() {
  const [active, setActive] = useState('All');

  return (
    <section id="gallery" className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <p className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: '${_info.primaryColor}' }}>Our Work</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">Gallery</h2>
          <p className="text-lg text-gray-600">See the quality and craftsmanship in every project we complete.</p>
        </div>

        {/* Filter */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActive(cat)}
              className={\`px-5 py-2 rounded-full text-sm font-medium transition-all \${
                active === cat
                  ? 'text-white shadow-lg'
                  : 'text-gray-600 bg-white border border-gray-200 hover:border-gray-300'
              }\`}
              style={active === cat ? { background: '${_info.primaryColor}' } : {}}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="aspect-[4/3] rounded-xl overflow-hidden bg-gray-200 group cursor-pointer">
              <img
                src={\`FAL_IMAGE[professional ${_info.businessName.toLowerCase()} project example \${i}, high quality work, clean result, commercial photography]\`}
                alt={\`Project \${i}\`}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}`;
}

export function generateReviews(_info: BusinessInfo): string {
  return `import React from 'react';
import { Star, Quote } from 'lucide-react';

const REVIEWS = [
  { name: 'Maria G.', text: 'Absolutely amazing service! The team was professional, on time, and the results exceeded our expectations. Highly recommend!', rating: 5 },
  { name: 'Carlos R.', text: 'Best in the Rio Grande Valley. Fair pricing, quality work, and they actually show up when they say they will.', rating: 5 },
  { name: 'Jennifer M.', text: 'We\'ve used them for multiple projects and they never disappoint. True professionals who take pride in their work.', rating: 5 },
  { name: 'Roberto S.', text: 'Outstanding customer service from start to finish. They went above and beyond to make sure we were happy.', rating: 5 },
];

export default function Reviews() {
  return (
    <section id="reviews" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: '${_info.primaryColor}' }}>Testimonials</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">What Our Customers Say</h2>
          <div className="flex items-center justify-center gap-1 mb-2">
            {[1,2,3,4,5].map(i => (
              <Star key={i} className="w-6 h-6 text-amber-400 fill-amber-400" />
            ))}
          </div>
          <p className="text-gray-500">Based on 500+ reviews</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {REVIEWS.map((review, i) => (
            <div key={i} className="p-6 rounded-2xl bg-gray-50 border border-gray-100 relative">
              <Quote className="w-8 h-8 text-gray-200 absolute top-6 right-6" />
              <div className="flex items-center gap-1 mb-3">
                {[...Array(review.rating)].map((_, j) => (
                  <Star key={j} className="w-4 h-4 text-amber-400 fill-amber-400" />
                ))}
              </div>
              <p className="text-gray-700 leading-relaxed mb-4">"{review.text}"</p>
              <p className="font-semibold text-gray-900">{review.name}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}`;
}

export function generateContact(info: BusinessInfo): string {
  return `import React from 'react';
import { Phone, Mail, MapPin, Clock, Send } from 'lucide-react';

export default function Contact() {
  return (
    <section id="contact" className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: '${info.primaryColor}' }}>Get In Touch</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">Contact Us</h2>
          <p className="text-lg text-gray-600">Ready to get started? Reach out today for a free consultation and quote.</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-10">
          {/* Contact Info */}
          <div className="space-y-6">
            <div className="flex items-start gap-4 p-5 rounded-xl bg-white border border-gray-100">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ background: '${info.primaryColor}15' }}>
                <Phone className="w-6 h-6" style={{ color: '${info.primaryColor}' }} />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Phone</h3>
                <a href="tel:${info.phone}" className="text-gray-600 hover:text-gray-900 transition-colors">${info.phone}</a>
              </div>
            </div>

            <div className="flex items-start gap-4 p-5 rounded-xl bg-white border border-gray-100">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ background: '${info.primaryColor}15' }}>
                <Mail className="w-6 h-6" style={{ color: '${info.primaryColor}' }} />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Email</h3>
                <a href="mailto:${info.email}" className="text-gray-600 hover:text-gray-900 transition-colors">${info.email}</a>
              </div>
            </div>

            <div className="flex items-start gap-4 p-5 rounded-xl bg-white border border-gray-100">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ background: '${info.primaryColor}15' }}>
                <MapPin className="w-6 h-6" style={{ color: '${info.primaryColor}' }} />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Address</h3>
                <p className="text-gray-600">${info.address}, ${info.city}, ${info.state}</p>
              </div>
            </div>

            <div className="flex items-start gap-4 p-5 rounded-xl bg-white border border-gray-100">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ background: '${info.primaryColor}15' }}>
                <Clock className="w-6 h-6" style={{ color: '${info.primaryColor}' }} />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Hours</h3>
                <p className="text-gray-600">Mon-Fri: 8:00 AM - 6:00 PM</p>
                <p className="text-gray-600">Sat: 9:00 AM - 4:00 PM</p>
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <div className="bg-white rounded-2xl p-8 border border-gray-100 shadow-sm">
            <form className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                  <input type="text" className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-gray-400 focus:ring-0 outline-none transition-colors" placeholder="John" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                  <input type="text" className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-gray-400 focus:ring-0 outline-none transition-colors" placeholder="Doe" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="tel" className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-gray-400 focus:ring-0 outline-none transition-colors" placeholder="(956) 555-1234" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service Needed</label>
                <select className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-gray-400 focus:ring-0 outline-none transition-colors bg-white">
                  <option value="">Select a service...</option>
                  ${info.services.map(s => `<option value="${s.name}">${s.name}</option>`).join('\n                  ')}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                <textarea rows={4} className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-gray-400 focus:ring-0 outline-none transition-colors resize-none" placeholder="Tell us about your project..." />
              </div>
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-lg text-white font-semibold transition-all hover:opacity-90 shadow-lg"
                style={{ background: '${info.primaryColor}' }}
              >
                <Send className="w-5 h-5" />
                Send Message
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}`;
}

export function generateFAQ(info: BusinessInfo): string {
  const faqItems = info.services.map((service, i) => {
    return `    {
      q: 'How does your ${service.name.toLowerCase()} service work?',
      a: '${service.description} We handle everything from start to finish with transparent pricing and no hidden fees. Contact us today for a free consultation.',
    }`;
  }).join(',\n');

  return `import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const FAQS = [
${faqItems},
  {
    q: 'Do you offer free estimates?',
    a: 'Yes! We offer free, no-obligation estimates for all our services. Contact us today and we\'ll assess your needs and provide a transparent quote.',
  },
  {
    q: 'What areas do you serve?',
    a: 'We proudly serve ${info.city}, ${info.state} and the surrounding areas. Contact us to confirm service availability in your location.',
  },
  {
    q: 'Are you licensed and insured?',
    a: 'Absolutely. We are fully licensed and insured for your protection and peace of mind. Our team consists of trained professionals who take pride in quality work.',
  },
];

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="py-24 bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <p className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: '${info.primaryColor}' }}>FAQ</p>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900">Frequently Asked Questions</h2>
        </div>

        <div className="space-y-3">
          {FAQS.map((faq, i) => (
            <div key={i} className="rounded-xl border border-gray-200 overflow-hidden">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 transition-colors"
              >
                <span className="font-semibold text-gray-900 pr-4">{faq.q}</span>
                <ChevronDown className={\`w-5 h-5 text-gray-400 shrink-0 transition-transform \${open === i ? 'rotate-180' : ''}\`} />
              </button>
              {open === i && (
                <div className="px-5 pb-5">
                  <p className="text-gray-600 leading-relaxed">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}`;
}
