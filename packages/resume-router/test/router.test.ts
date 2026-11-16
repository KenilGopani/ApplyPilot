import test from "node:test";
import assert from "node:assert/strict";
import { routeResume } from "../src/index.ts";

test("AI-centred roles route to the applied-AI resume", () => {
  const r = routeResume({ title: "Applied AI Engineer", description: "Build RAG pipelines, agents and evals with LLMs." });
  assert.equal(r.recommended, "applied-ai");
  assert.ok(r.confidence >= 0.5);
  assert.ok(r.signals.ai.includes("rag"));
});

test("backend roles route to the core resume, even when AI is mentioned in passing", () => {
  const r = routeResume({ title: "Backend Software Engineer", description: "Kafka, Postgres, distributed systems, APIs. Our product uses AI." });
  assert.equal(r.recommended, "core-swe");
  assert.match(r.reason, /Software engineering/);
});

test("AI plus product or full-stack routes to hybrid; an evaluation archetype settles close calls", () => {
  assert.equal(routeResume({ title: "Full-Stack AI Engineer", description: "React, TypeScript, LLM agents" }).recommended, "hybrid");
  const plain = routeResume({ title: "Software Engineer", description: "APIs and services" });
  assert.equal(plain.recommended, "core-swe");
  const withArch = routeResume({ title: "Software Engineer", description: "APIs and services", archetype: "Applied AI / LLM Engineer" });
  assert.notEqual(withArch.recommended, "core-swe");
});

test("only resumes the candidate has are recommended, with lower confidence when falling back", () => {
  const r = routeResume({ title: "Backend Engineer", description: "Kafka and Postgres" }, ["applied-ai"]);
  assert.equal(r.ideal, "core-swe");
  assert.equal(r.recommended, "applied-ai");
  assert.ok(r.confidence <= 0.5);
  assert.match(r.reason, /no core-swe resume yet/);
  assert.equal(r.alternative, null);
});
