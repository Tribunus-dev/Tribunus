// Metal IOSurface bridge — create MTLTextures from IOSurfaces, dispatch
// compute kernels, and manage texture lifecycle.
//
// Thread-safety contract:
//   tribunus_metal_texture_from_iosurface   — thread-safe (each call creates a
//     new MTLTexture; Metal device creation is internally serialized).
//   tribunus_metal_dispatch_copy            — NOT thread-safe on the same
//     texture; callers must serialize access per texture.
//   tribunus_metal_release_texture          — thread-safe (release on the
//     Metal device's MTLTexture; safe to call from any thread).

#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Create a Metal texture (MTLPixelFormatR32Float) backed by the IOSurface
/// attached to a CVPixelBuffer.
///
/// @param cv_pixel_buffer  A CVPixelBufferRef whose IOSurface is used as the
///                         texture's backing store.  Must have pixel format
///                         kCVPixelFormatType_OneComponent32Float.
/// @param device_name      Metal device name string (e.g. "Apple M1"), or NULL
///                         to use the system-preferred device.
/// @return An MTLTexture* on success, or NULL on failure.
void* tribunus_metal_texture_from_iosurface(void* cv_pixel_buffer,
                                            const char* device_name);

/// Dispatch a simple compute kernel that copies linear float data into the
/// IOSurface-backed Metal texture.
///
/// The texture must have been created by
/// tribunus_metal_texture_from_iosurface.  The input data is uploaded to a
/// Metal buffer and a blit/compute operation copies it to the texture.
///
/// NOT thread-safe for concurrent calls on the same texture.
///
/// @param texture       MTLTexture* to write into.
/// @param input_data    Float array of length element_count.
/// @param element_count Number of float elements to copy.
/// @return 0 on success, negative on error.
int tribunus_metal_dispatch_copy(void* texture,
                                  const float* input_data,
                                  int element_count);

/// Release a Metal texture created by tribunus_metal_texture_from_iosurface.
///
/// Safe to call with NULL (no-op).  Also safe to call from any thread.
///
/// @param texture  MTLTexture* to release, or NULL.
void tribunus_metal_release_texture(void* texture);

#ifdef __cplusplus
}
#endif
