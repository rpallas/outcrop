#!/usr/bin/env node
import { PlatformApp } from "@rpallas/outcrop";
import config from "../../platform.config";
import { {{Service}}Stack } from "../lib/service-stack";

const app = new PlatformApp({ config });
new {{Service}}Stack(app, "Service");
