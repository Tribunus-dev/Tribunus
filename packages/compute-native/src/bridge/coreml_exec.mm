
// ── compute plan inspection ────────────────────────────────────────────────

int tribunus_coreml_inspect_compute_plan(
    const char* path,
    char** out_summary
) {
    if (!path || !out_summary) return -1;
    *out_summary = NULL;

    if (@available(macOS 14.4, iOS 17.4, *)) {
        @autoreleasepool {
            @try {
                NSURL* url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
                NSError* error = nil;

                dispatch_semaphore_t sem = dispatch_semaphore_create(0);
                __block id loadedPlan = nil;
                __block NSError* loadedError = nil;

                MLModelConfiguration* config = [[MLModelConfiguration alloc] init];

                Class MLComputePlanClass = NSClassFromString(@"MLComputePlan");
                if (!MLComputePlanClass) return -3;

                [MLComputePlanClass loadContentsOfURL:url configuration:config completionHandler:^(id _Nullable computePlan, NSError * _Nullable err) {
                    loadedPlan = computePlan;
                    loadedError = err;
                    dispatch_semaphore_signal(sem);
                }];

                dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);

                if (!loadedPlan) {
                    fprintf(stderr, "coreml_inspect_compute_plan: failed to load %s: %s
",
                            path, loadedError ? loadedError.localizedDescription.UTF8String : "unknown error");
                    return -2;
                }

                NSString* summaryStr = [loadedPlan description];
                if (!summaryStr) {
                    summaryStr = @"Loaded ComputePlan but description is nil";
                }
                *out_summary = strdup(summaryStr.UTF8String);
                return 0;
            } @catch (NSException* exc) {
                fprintf(stderr, "coreml_inspect_compute_plan EXCEPTION: %s
", exc.description.UTF8String);
                return -20;
            }
        }
    } else {
        return -99; // unavailable
    }
}

extern "C" void tribunus_coreml_free_string(char* s) {
    if (s) free(s);
}

