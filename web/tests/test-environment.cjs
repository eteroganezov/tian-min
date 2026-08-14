"use strict";

// Test processes must never inherit permission to use the real OpenAI provider.
process.env.NODE_ENV = "test";
