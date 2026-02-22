#!/usr/bin/env -S node --enable-source-maps
import process from "node:process";
import { runBackfillMythicPresentationWordbank } from "./backfill-mythic-presentation-wordbank.js";

runBackfillMythicPresentationWordbank(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
