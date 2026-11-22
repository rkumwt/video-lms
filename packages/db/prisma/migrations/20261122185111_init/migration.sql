-- CreateEnum
CREATE TYPE "RecordingType" AS ENUM ('SCREEN', 'SCREEN_CAMERA');

-- CreateEnum
CREATE TYPE "StorageType" AS ENUM ('LOCAL', 'S3');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "RecordingQuality" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "videos" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "recordingType" "RecordingType" NOT NULL,
    "storageType" "StorageType" NOT NULL,
    "storageKey" VARCHAR(1024) NOT NULL,
    "thumbnailKey" VARCHAR(1024),
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "mimeType" VARCHAR(100) NOT NULL,
    "status" "VideoStatus" NOT NULL DEFAULT 'UPLOADING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "storageTarget" "StorageType" NOT NULL DEFAULT 'S3',
    "defaultRecordingMode" "RecordingType" NOT NULL DEFAULT 'SCREEN',
    "quality" "RecordingQuality" NOT NULL DEFAULT 'MEDIUM',
    "micEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "videos_createdAt_idx" ON "videos"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "videos_status_idx" ON "videos"("status");

-- Settings is a singleton: only the row with id = 1 may exist.
ALTER TABLE "settings" ADD CONSTRAINT "settings_singleton" CHECK ("id" = 1);

-- Seed the default settings row so the app always has one to read.
INSERT INTO "settings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;
