CREATE TABLE "SiteAnalyticsEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "path" TEXT,
    "href" TEXT,
    "label" TEXT,
    "referrerHost" TEXT,
    "referrerUrl" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "deviceType" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "locale" TEXT,
    "timezone" TEXT,
    "viewportWidth" INTEGER,
    "viewportHeight" INTEGER,
    "screenWidth" INTEGER,
    "screenHeight" INTEGER,
    "metricName" TEXT,
    "metricValue" REAL,
    "metricUnit" TEXT,
    "navigationType" TEXT,
    "metaJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "SiteAnalyticsEvent_createdAt_idx" ON "SiteAnalyticsEvent"("createdAt");
CREATE INDEX "SiteAnalyticsEvent_eventType_createdAt_idx" ON "SiteAnalyticsEvent"("eventType", "createdAt");
CREATE INDEX "SiteAnalyticsEvent_sessionId_createdAt_idx" ON "SiteAnalyticsEvent"("sessionId", "createdAt");
CREATE INDEX "SiteAnalyticsEvent_path_createdAt_idx" ON "SiteAnalyticsEvent"("path", "createdAt");
