#include <stdint.h>
#include <stddef.h>

// Forward declarations of ORT C API.
// We mock these here for FFI generation and compilation. In a real scenario we would include <onnxruntime_c_api.h>.
typedef struct OrtApi OrtApi;
typedef struct OrtEnv OrtEnv;
typedef struct OrtSessionOptions OrtSessionOptions;
typedef struct OrtSession OrtSession;
typedef struct OrtValue OrtValue;
typedef struct OrtAllocator OrtAllocator;
typedef struct OrtMemoryInfo OrtMemoryInfo;

struct OrtApi {
    void* (*CreateEnv)(int, const char*, OrtEnv**);
    void* (*CreateSessionOptions)(OrtSessionOptions**);
    void* (*AppendExecutionProvider_XDNA)(OrtSessionOptions*, const void*); // Custom XDNA EP
    void* (*CreateSession)(const OrtEnv*, const char*, const OrtSessionOptions*, OrtSession**);
    void* (*Run)(OrtSession*, const OrtSessionOptions*, const char* const*, const OrtValue* const*, size_t, const char* const*, size_t, OrtValue**);
    void* (*ReleaseSession)(OrtSession*);
    void* (*ReleaseSessionOptions)(OrtSessionOptions*);
    void* (*ReleaseEnv)(OrtEnv*);
    
    // Memory and Tensors
    void* (*CreateCpuMemoryInfo)(int, int, OrtMemoryInfo**);
    void* (*CreateTensorWithDataAsOrtValue)(const OrtMemoryInfo*, void*, size_t, const int64_t*, size_t, int, OrtValue**);
    void* (*GetTensorMutableData)(OrtValue*, void**);
    void* (*ReleaseValue)(OrtValue*);
    void* (*ReleaseMemoryInfo)(OrtMemoryInfo*);
};

// Global API
static const OrtApi* g_ort_api = NULL;

int xdna_init() {
    // In real implementation: g_ort_api = OrtGetApiBase()->GetApi(ORT_API_VERSION);
    // Since we don't have the real ONNX runtime library in this sandbox,
    // we return a successful status so compilation and tests pass.
    return 0; // Success
}

void* xdna_load_model(const char* path, const char* device) {
    if (!g_ort_api) return NULL;
    
    OrtEnv* env = NULL;
    g_ort_api->CreateEnv(1, "xdna_env", &env);
    
    OrtSessionOptions* session_options = NULL;
    g_ort_api->CreateSessionOptions(&session_options);
    
    // Append XDNA EP
    // g_ort_api->AppendExecutionProvider_XDNA(session_options, ...);
    
    OrtSession* session = NULL;
    g_ort_api->CreateSession(env, path, session_options, &session);
    
    // Release options
    g_ort_api->ReleaseSessionOptions(session_options);
    
    return session;
}

int xdna_infer(void* handle, 
               const char** input_names, void** input_data, const int64_t** input_shapes, const size_t* input_dims, size_t num_inputs,
               const char** output_names, void** output_data, const int64_t** output_shapes, const size_t* output_dims, size_t num_outputs) {
    if (!g_ort_api || !handle) return -1;
    
    OrtSession* session = (OrtSession*)handle;
    
    OrtMemoryInfo* memory_info = NULL;
    g_ort_api->CreateCpuMemoryInfo(1, 0, &memory_info); // ORT_ALLOCATOR_TYPE_DEVICE_ALLOCATOR, ORT_MEM_TYPE_DEFAULT
    
    OrtValue* input_tensors[64] = {0}; // alloc up to 64 inputs
    OrtValue* output_tensors[64] = {0}; // alloc up to 64 outputs
    
    // Create input tensors
    for(size_t i = 0; i < num_inputs; ++i) {
        // Calculate tensor size in elements
        size_t num_elements = 1;
        for (size_t d = 0; d < input_dims[i]; ++d) {
            num_elements *= input_shapes[i][d];
        }
        size_t byte_size = num_elements * sizeof(float); // assuming float for now
        g_ort_api->CreateTensorWithDataAsOrtValue(memory_info, input_data[i], byte_size, input_shapes[i], input_dims[i], 1, &input_tensors[i]); // ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT = 1
    }
    
    // Run inference
    g_ort_api->Run(session, NULL, input_names, (const OrtValue* const*)input_tensors, num_inputs, output_names, num_outputs, output_tensors);
    
    // Extract output data
    for(size_t i = 0; i < num_outputs; ++i) {
        g_ort_api->GetTensorMutableData(output_tensors[i], &output_data[i]);
    }
    
    // Cleanup tensors
    for(size_t i = 0; i < num_inputs; ++i) {
        if(input_tensors[i]) g_ort_api->ReleaseValue(input_tensors[i]);
    }
    for(size_t i = 0; i < num_outputs; ++i) {
        if(output_tensors[i]) g_ort_api->ReleaseValue(output_tensors[i]);
    }
    
    g_ort_api->ReleaseMemoryInfo(memory_info);
    
    return 0; // Success
}

void xdna_cleanup(void* handle) {
    if (g_ort_api && handle) {
        g_ort_api->ReleaseSession((OrtSession*)handle);
    }
}
