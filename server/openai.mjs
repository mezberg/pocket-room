// One OpenAI client for every lane. Models come from .env so a lane can swap one without touching code.
import OpenAI from "openai";
export const openai = new OpenAI();          // reads OPENAI_API_KEY
export const MODELS = {
  text: process.env.OPENAI_MODEL_TEXT,         // vision + reasoning (Responses API)
  decisions: process.env.OPENAI_MODEL_DECISIONS,
  image: process.env.OPENAI_MODEL_IMAGE,
  realtime: process.env.OPENAI_MODEL_REALTIME,
};
