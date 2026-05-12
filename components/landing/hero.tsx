"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Code2, Zap } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export function Hero() {
  return (
    <div className="relative overflow-hidden pt-[120px] pb-32">
      {/* Background gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] opacity-30 select-none pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/40 to-purple-500/40 blur-[100px] rounded-full mix-blend-screen" />
      </div>

      <div className="container relative z-10 mx-auto px-4 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm mb-8"
        >
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-white/80">The Ultimate AI App Builder</span>
        </motion.div>

        <motion.h1 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-5xl md:text-7xl font-bold tracking-tight mb-8 max-w-4xl mx-auto"
        >
          Describe your app.{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-400">
            Let AI build it.
          </span>
        </motion.h1>

        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-12 leading-relaxed"
        >
          Build apps and websites faster. HS Solutions App & Web Builder turns your plain English requirements into production-ready React code in seconds.
        </motion.p>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link href="/sign-up">
            <Button size="lg" className="h-14 px-8 text-lg bg-primary text-primary-foreground hover:bg-primary/90 gap-2 w-full sm:w-auto shadow-lg shadow-primary/25">
              Start Building Free <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button size="lg" variant="outline" className="h-14 px-8 text-lg w-full sm:w-auto bg-white/5 border-white/10 hover:bg-white/10 backdrop-blur-sm">
               View Dashboard
            </Button>
          </Link>
        </motion.div>

        {/* Features Grid */}
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-32 max-w-5xl mx-auto text-left"
        >
          <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm hover:bg-white/10 transition-colors">
            <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center mb-4 border border-primary/30">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2 text-foreground">Multimodal AI</h3>
            <p className="text-muted-foreground">Powered by Claude 3.5 Sonnet, GPT-4o, and Gemini. Choose the best model for your specific needs.</p>
          </div>
          <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm hover:bg-white/10 transition-colors">
            <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center mb-4 border border-purple-500/30">
              <Code2 className="w-6 h-6 text-purple-400" />
            </div>
            <h3 className="text-xl font-semibold mb-2 text-foreground">Full Stack React</h3>
            <p className="text-muted-foreground">Generates production-grade React 19 code with modern Tailwind CSS and beautiful UI components.</p>
          </div>
          <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm hover:bg-white/10 transition-colors">
            <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center mb-4 border border-blue-500/30">
              <Zap className="w-6 h-6 text-blue-400" />
            </div>
            <h3 className="text-xl font-semibold mb-2 text-foreground">Live Preview</h3>
            <p className="text-muted-foreground">Watch your app come to life in real-time with our integrated Sandpack environment. No local setup needed.</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
