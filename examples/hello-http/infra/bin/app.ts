#!/usr/bin/env node
import { PlatformApp } from "@rpallas/platform-cdk";
import config from "../../platform.config";
import { HelloHttpStack } from "../lib/service-stack";

const app = new PlatformApp({ config });
new HelloHttpStack(app, "Service");
