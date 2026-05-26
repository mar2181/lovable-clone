"use client";

import { Button } from "@/components/ui/button";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { WebGLShader } from "@/components/ui/web-gl-shader";
import { ArrowRight, Sparkles, Code2, Zap } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export function Hero() {
  return (
    <div className="relative w-full pt-24 pb-32">
      {/* Animated WebGL shader background — sits behind the hero */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <WebGLShader />
        {/* Soft vignette so the copy stays readable */}
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/10 to-background" />
      </div>

      <div className="relative z-10 flex w-full flex-col items-center justify-center overflow-hidden px-4">
        <div className="relative border border-[#27272a] p-2 w-full mx-auto max-w-3xl bg-black/40 backdrop-blur-sm">
          <main className="relative border border-[#27272a] py-10 overflow-hidden">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mx-auto mb-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm w-fit"
            >
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-white/80">The HS Solutions App &amp; Web Builder</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="mb-3 text-white text-center text-6xl font-extrabold tracking-tighter md:text-[clamp(2rem,8vw,7rem)] leading-[0.95]"
            >
              Describe it.{" "}
              <span className="font-serif italic font-normal tracking-tight hero-shimmer-text">
                Ship&nbsp;it.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-white/60 px-6 text-center text-xs md:text-sm lg:text-lg"
            >
              Turn plain-English ideas into production-ready React apps in seconds. Built by HS Solutions for builders who don&rsquo;t have time to wait on devs.
            </motion.p>

            <div className="my-8 flex items-center justify-center gap-2">
              <span className="relative flex h-3 w-3 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
              </span>
              <p className="text-xs text-green-500">Available for New Projects</p>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <Link href="/sign-up">
                <LiquidButton className="text-white border rounded-full" size="xl">
                  Start Building Free <ArrowRight className="w-5 h-5" />
                </LiquidButton>
              </Link>
              <Link href="/dashboard">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 px-8 text-base rounded-full bg-white/5 border-white/10 hover:bg-white/10 backdrop-blur-sm text-white"
                >
                  View Dashboard
                </Button>
              </Link>
            </motion.div>
          </main>
        </div>

        {/* Features Grid */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-24 max-w-5xl mx-auto text-left w-full"
        >
          <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm hover:bg-white/10 transition-colors">
            <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center mb-4 border border-primary/30">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2 text-foreground">Multimodal AI</h3>
            <p className="text-muted-foreground">Powered by Claude 3.5 Sonnet, GPT-4o, and Gemini. Choose the best model for your specific needs.</p>
          </div>
          <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm hover:bg-white/10 transition-colors">
            <div className="w-12 h-12 rounded-lg bg-cyan-500/20 flex items-center justify-center mb-4 border border-cyan-500/30">
              <Code2 className="w-6 h-6 text-cyan-400" />
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
