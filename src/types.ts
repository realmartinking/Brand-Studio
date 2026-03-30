import { Context } from "grammy";
import { SessionData } from "./session";

export type BotContext = Context & { session: SessionData };
