    fn tribunus_coreml_stateful_request_set_waker(
        request: *mut std::ffi::c_void,
        waker: *mut std::ffi::c_void,
    );
    fn poll(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Self::Output> {
                std::task::Poll::Ready(Err(format!(
                    "async prediction failed with status: {}",
                    status
                )))
            return Err(format!(
                "tribunus_coreml_predict_stateful failed: {}",
                status
            ));
            return Err(format!(
                "tribunus_coreml_predict_stateful_async failed: {}",
                status
            ));
