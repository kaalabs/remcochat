import { tool as createTool } from "ai";
import { z } from "zod";
import { getWeatherForLocation, getWeatherForecastForLocation } from "@/ai/weather";

export const displayWeather = createTool({
  description:
    "Display the current weather and a short forecast for a location.",
  inputSchema: z.object({
    location: z.string().describe("The location to get the weather for"),
  }),
  execute: async ({ location }) => {
    return getWeatherForLocation({ location, forecastDays: 3 });
  },
});

export const displayWeatherForecast = createTool({
  description: "Display a multi-day weather forecast for a location.",
  inputSchema: z.object({
    location: z.string().describe("The location to get the forecast for"),
  }),
  execute: async ({ location }) => {
    return getWeatherForecastForLocation({ location, forecastDays: 7 });
  },
});

export const displayMemoryAnswer = createTool({
  description:
    "Display an answer that was derived from saved memory in a special memory card.",
  inputSchema: z.object({
    answer: z.string().describe("The assistant's final answer text"),
  }),
  execute: async ({ answer }) => {
    return { answer };
  },
});

export const tools = {
  displayWeather,
  displayWeatherForecast,
  displayMemoryAnswer,
};
