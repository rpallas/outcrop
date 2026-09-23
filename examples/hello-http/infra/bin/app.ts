#!/usr/bin/env node
import { PlatformApp } from "@rpallas/outcrop";
import config from "../../platform.config";
import { HelloHttpStack } from "../lib/service-stack";

const app = new PlatformApp({ config });
new HelloHttpStack(app, "Service");
