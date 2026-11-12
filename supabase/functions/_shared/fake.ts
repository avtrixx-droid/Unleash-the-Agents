// Fake attendees for rehearsals, load tests and the stage demo mode.
import { rng } from "./matcher.ts";

const FIRST = "Aarav Priya Arjun Ananya Rohan Isha Kabir Meera Vivaan Diya Aditya Sara Neha Rahul Zoya Kiran Nikhil Tara Dev Riya Omar Lena Yusuf Mia Noah Ava Leo Emma Ethan Chloe Ravi Sana Farhan Aisha Karan Pooja Vikram Naina Arnav Tanvi Sam Alex Jordan Maya Hiro Yuki Lucas Sofia Mateo Amara".split(" ");
const LAST = "Sharma Patel Iyer Reddy Khan Gupta Nair Singh Das Menon Rao Kapoor Joshi Bose Mehta Verma Pillai Chen Kim Garcia Silva Novak Okafor Haddad Tanaka Müller Rossi Costa".split(" ");

const THEMES: { build: string[]; need: string[] }[] = [
  {
    build: ["a voice agent that books clinic appointments", "a real-time voice assistant for call centres", "speech-to-speech agent for regional languages"],
    need: ["cutting voice latency below 500ms", "handling interruptions in voice conversations", "evaluating voice agent quality"],
  },
  {
    build: ["an eval harness for RAG pipelines", "LLM-as-judge tooling for support bots", "regression tests for prompt changes"],
    need: ["getting real users to try our eval tool", "pricing a developer tool", "scaling evals to thousands of cases"],
  },
  {
    build: ["a RAG chatbot over legal contracts", "semantic search for internal docs", "a knowledge assistant for sales teams"],
    need: ["evaluating retrieval quality", "chunking long PDFs well", "reducing hallucinations in answers"],
  },
  {
    build: ["a coding agent that writes unit tests", "an autonomous PR reviewer", "a CLI agent that fixes flaky tests"],
    need: ["sandboxing code execution safely", "keeping agents from going in loops", "finding design partners at big companies"],
  },
  {
    build: ["multi-agent research workflows", "an agent orchestration framework", "a browser agent for form filling"],
    need: ["observability and tracing for agents", "reliable tool calling", "cost control for long-running agents"],
  },
  {
    build: ["an AI tutor for school students", "personalised learning paths with LLMs", "a quiz generator for teachers"],
    need: ["distribution to schools", "making AI answers safe for kids", "a cofounder with sales experience"],
  },
  {
    build: ["a fintech fraud detection model", "an AI bookkeeping assistant for SMBs", "invoice extraction with vision models"],
    need: ["compliance and data privacy advice", "fundraising for a seed round", "accurate table extraction from scans"],
  },
  {
    build: ["a healthcare triage chatbot", "clinical note summarisation", "a mental health journaling app"],
    need: ["HIPAA-style data handling", "getting doctors to trust AI output", "evaluating medical answers"],
  },
  {
    build: ["an on-device LLM for phones", "a quantised model server on edge GPUs", "fine-tuning small models for classification"],
    need: ["GPU credits", "fine-tuning data pipelines", "benchmarking small models"],
  },
  {
    build: ["a no-code agent builder for marketers", "AI social media content workflows", "a personalised email outreach agent"],
    need: ["growth and first 100 users", "avoiding spammy AI output", "pricing a SaaS product"],
  },
];

export interface FakePerson {
  full_name: string;
  building: string;
  need: string;
}

export function fakePeople(count: number, seed = 7): FakePerson[] {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const out: FakePerson[] = [];
  for (let i = 0; i < count; i++) {
    const t = pick(THEMES);
    // ~35% of people need something from a different theme: that is what
    // creates complementary matches across groups.
    const needTheme = r() < 0.35 ? pick(THEMES) : t;
    out.push({ full_name: `${pick(FIRST)} ${pick(LAST)}`, building: pick(t.build), need: pick(needTheme.need) });
  }
  return out;
}
