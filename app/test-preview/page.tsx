"use client";

import { PreviewPanel } from "@/components/editor/preview-panel";

// Simulated AI-generated files (same structure as what's stored in R2)
const TEST_FILES: Record<string, string> = {
  "/src/App.tsx": `import React from 'react';
import { Phone, Mail, MapPin, Star, Wrench, Home, PaintBucket, Hammer, Ruler, Building } from 'lucide-react';

const services = [
  { icon: 'wrench', title: 'Kitchen Remodeling', desc: 'Transform your kitchen into a modern masterpiece' },
  { icon: 'home', title: 'Bathroom Renovation', desc: 'Luxury bathroom upgrades and remodels' },
  { icon: 'building', title: 'Room Additions', desc: 'Expand your living space with quality additions' },
  { icon: 'hammer', title: 'Roofing', desc: 'Professional roofing installation and repair' },
  { icon: 'ruler', title: 'Flooring', desc: 'Beautiful flooring for every room' },
  { icon: 'paintbucket', title: 'Outdoor Living', desc: 'Patios, decks, and outdoor kitchens' },
];

const iconMap: Record<string, React.ReactNode> = {
  wrench: <Wrench className="w-8 h-8" />, home: <Home className="w-8 h-8" />,
  building: <Building className="w-8 h-8" />, hammer: <Hammer className="w-8 h-8" />,
  ruler: <Ruler className="w-8 h-8" />, paintbucket: <PaintBucket className="w-8 h-8" />,
};

export default function App() {
  return (
    <div className="min-h-screen bg-neutral-900 text-white">
      {/* Hero */}
      <section className="relative h-[70vh] flex items-center justify-center bg-gradient-to-br from-neutral-900 via-neutral-800 to-amber-900/30">
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative z-10 text-center px-4">
          <h1 className="text-5xl md:text-7xl font-bold mb-4">
            <span className="text-amber-400">Eagle</span> Construction
          </h1>
          <p className="text-xl md:text-2xl text-neutral-300 mb-8 max-w-2xl mx-auto">
            Building dreams and remodeling homes in the Rio Grande Valley since 2005
          </p>
          <a href="#contact" className="inline-block bg-amber-500 hover:bg-amber-600 text-black font-bold py-3 px-8 rounded-lg text-lg transition-colors">
            Get Free Estimate
          </a>
        </div>
      </section>

      {/* Services */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">Our <span className="text-amber-400">Services</span></h2>
          <p className="text-neutral-400 text-center mb-12 max-w-2xl mx-auto">Complete construction and remodeling solutions tailored to your vision</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {services.map((s, i) => (
              <div key={i} className="bg-neutral-800 border border-neutral-700 rounded-xl p-6 hover:border-amber-400/50 transition-colors">
                <div className="text-amber-400 mb-4">{iconMap[s.icon]}</div>
                <h3 className="text-xl font-bold mb-2">{s.title}</h3>
                <p className="text-neutral-400">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section className="py-20 px-4 bg-neutral-800/50">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold mb-6">About <span className="text-amber-400">Eagle Construction</span></h2>
            <p className="text-neutral-300 mb-4">With over 20 years of experience serving McAllen, Edinburg, Mission, and the entire Rio Grande Valley, Eagle Construction has built a reputation for quality craftsmanship and exceptional service.</p>
            <p className="text-neutral-300 mb-6">We are fully licensed, insured, and committed to delivering your project on time and within budget.</p>
            <div className="flex gap-8">
              <div><div className="text-3xl font-bold text-amber-400">500+</div><div className="text-neutral-400">Projects Done</div></div>
              <div><div className="text-3xl font-bold text-amber-400">20+</div><div className="text-neutral-400">Years Experience</div></div>
              <div><div className="text-3xl font-bold text-amber-400">100%</div><div className="text-neutral-400">Satisfaction</div></div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-amber-400/20 to-neutral-800 rounded-2xl h-80 flex items-center justify-center">
            <Star className="w-20 h-20 text-amber-400/50" />
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">Get Your <span className="text-amber-400">Free Estimate</span></h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="flex items-center gap-4"><Phone className="w-6 h-6 text-amber-400" /><div><div className="font-bold">Call Us</div><div className="text-neutral-400">(956) 555-0123</div></div></div>
              <div className="flex items-center gap-4"><Mail className="w-6 h-6 text-amber-400" /><div><div className="font-bold">Email</div><div className="text-neutral-400">info@eagleconstruction.com</div></div></div>
              <div className="flex items-center gap-4"><MapPin className="w-6 h-6 text-amber-400" /><div><div className="font-bold">Service Area</div><div className="text-neutral-400">McAllen, Edinburg, Mission & RGV</div></div></div>
            </div>
            <form className="space-y-4">
              <input placeholder="Your Name" className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-amber-400 focus:outline-none" />
              <input placeholder="Phone Number" className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-amber-400 focus:outline-none" />
              <input placeholder="Email" className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-amber-400 focus:outline-none" />
              <textarea placeholder="Describe your project..." rows={4} className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-3 text-white placeholder:text-neutral-500 focus:border-amber-400 focus:outline-none resize-none" />
              <button type="button" className="w-full bg-amber-500 hover:bg-amber-600 text-black font-bold py-3 rounded-lg transition-colors">Request Free Estimate</button>
            </form>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-neutral-800 border-t border-neutral-700 py-8 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <div className="text-amber-400 font-bold text-xl mb-2">Eagle Construction & Remodeling</div>
          <p className="text-neutral-400">Serving the Rio Grande Valley since 2005</p>
          <p className="text-neutral-500 text-sm mt-4">Licensed & Insured | All Rights Reserved</p>
        </div>
      </footer>
    </div>
  );
}`,
};

export default function TestPreviewPage() {
  return (
    <div className="h-screen w-full bg-zinc-950">
      <div className="h-12 flex items-center px-4 border-b border-white/10">
        <h1 className="text-white font-bold">Sandpack Preview Test - Eagle Construction</h1>
      </div>
      <div className="h-[calc(100vh-48px)]">
        <PreviewPanel files={TEST_FILES} />
      </div>
    </div>
  );
}
