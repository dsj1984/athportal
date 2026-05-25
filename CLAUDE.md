# Agent Protocols - Always-Loaded Context

@AGENTS.md
@.agentrc.json

## System Prompt

@.agents/instructions.md

## Default Persona (Engineer)

@.agents/personas/engineer.md

## Global Rules (always active)

@.agents/rules/git-conventions.md
@.agents/rules/orchestration-error-handling.md
@.agents/rules/security-baseline.md
@.agents/rules/shell-conventions.md
@.agents/rules/testing-standards.md

<!--
  Project docs (architecture.md, data-dictionary.md, decisions.md,
  patterns.md, personas.md, style-guide.md, testing-strategy.md,
  web-routes.md) are loaded via `.agentrc.json` → `project.docsContextFiles`,
  which `.agents/instructions.md` §3 (Mandatory Reading) directs every
  agent to read before starting any task. Listing them here as well
  would duplicate the injection for Claude Code without reaching
  non-Claude hosts; the agentrc list is the host-agnostic single source
  of truth.
-->

