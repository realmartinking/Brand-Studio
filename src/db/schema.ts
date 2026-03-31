import {
  pgTable,
  uuid,
  bigint,
  varchar,
  timestamp,
  integer,
  text,
  jsonb,
  decimal,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums
export const userRoleEnum = pgEnum("user_role", ["client", "manager", "admin"]);

export const projectStatusEnum = pgEnum("project_status", [
  "draft",
  "briefing",
  "in_progress",
  "review",
  "completed",
  "archived",
]);

export const briefStatusEnum = pgEnum("brief_status", [
  "in_progress",
  "complete",
  "revised",
]);

export const moduleRunStatusEnum = pgEnum("module_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "revision",
]);

export const artifactTypeEnum = pgEnum("artifact_type", [
  "brief",
  "brand_dna",
  "verbal_system",
  "concept_direction",
  "visual_identity",
  "deliverable",
]);

export const artifactStatusEnum = pgEnum("artifact_status", [
  "draft",
  "approved",
  "superseded",
]);

// Tables
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  telegramId: bigint("telegram_id", { mode: "bigint" }).unique().notNull(),
  role: userRoleEnum("role").notNull().default("client"),
  displayName: varchar("display_name", { length: 255 }),
  activeProjectId: uuid("active_project_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  status: projectStatusEnum("status").notNull().default("draft"),
  currentModule: integer("current_module").notNull().default(1),
  styleGuide: text("style_guide"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const briefs = pgTable("briefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  status: briefStatusEnum("status").notNull().default("in_progress"),
  data: jsonb("data"),
  summary: text("summary"),
  gaps: jsonb("gaps"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const moduleRuns = pgTable("module_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  moduleNum: integer("module_num").notNull(),
  status: moduleRunStatusEnum("status").notNull().default("queued"),
  aiProvider: varchar("ai_provider", { length: 100 }),
  model: varchar("model", { length: 100 }),
  input: jsonb("input"),
  output: jsonb("output"),
  tokensUsed: integer("tokens_used"),
  costUsd: decimal("cost_usd", { precision: 10, scale: 6 }),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const artifacts = pgTable("artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleRunId: uuid("module_run_id")
    .notNull()
    .references(() => moduleRuns.id),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  type: artifactTypeEnum("type").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  data: jsonb("data"),
  version: integer("version").notNull().default(1),
  status: artifactStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const figmaReferences = pgTable("figma_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id),
  figmaFileKey: varchar("figma_file_key", { length: 255 }).notNull(),
  pageId: varchar("page_id", { length: 255 }).notNull(),
  pageName: varchar("page_name", { length: 255 }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  briefs: many(briefs),
  moduleRuns: many(moduleRuns),
  artifacts: many(artifacts),
}));

export const briefsRelations = relations(briefs, ({ one }) => ({
  project: one(projects, { fields: [briefs.projectId], references: [projects.id] }),
}));

export const moduleRunsRelations = relations(moduleRuns, ({ one, many }) => ({
  project: one(projects, { fields: [moduleRuns.projectId], references: [projects.id] }),
  artifacts: many(artifacts),
}));

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  moduleRun: one(moduleRuns, { fields: [artifacts.moduleRunId], references: [moduleRuns.id] }),
  project: one(projects, { fields: [artifacts.projectId], references: [projects.id] }),
}));
