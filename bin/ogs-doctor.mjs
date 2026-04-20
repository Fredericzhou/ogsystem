#!/usr/bin/env node

import { handleDoctorCliError, main } from "../dist/runtime/doctor.js";

main().catch(handleDoctorCliError);
