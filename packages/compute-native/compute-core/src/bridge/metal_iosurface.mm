// Metal IOSurface interop bridge — Phase 1.
// Creates MTLTexture from CVPixelBuffer IOSurface and copies CPU data via blit
// encoder.  No .metal shader dependency (Phase 1 uses MTLBlitCommandEncoder).

#import <Metal/Metal.h>
#import <IOSurface/IOSurface.h>
#import <CoreVideo/CoreVideo.h>
#import <stdint.h>
#import <stdlib.h>
#import <string.h>

extern "C" {

// ── texture from IOSurface ────────────────────────────────────────────────

/// Create a MTLTexture wrapping the IOSurface backing a CVPixelBuffer.
/// Pixel format: R32Float, width derived from IOSurface width, height = 1.
/// Returns a +1 retained texture (caller must release via
/// tribunus_metal_release_texture) or NULL on failure.
void* tribunus_metal_texture_from_iosurface(
    void* cv_pixel_buffer,   // CVPixelBufferRef
    const char* device_name  // NULL or empty = default device
) {
    if (!cv_pixel_buffer) return NULL;

    @autoreleasepool {
        id<MTLDevice> device = nil;

        // ── select device ──────────────────────────────────────────────
        if (device_name && device_name[0] != '\0') {
            NSString* targetName = [NSString stringWithUTF8String:device_name];
            // MTLCopyAllDevices returns +1 array; ARC releases it at scope exit.
            NSArray<id<MTLDevice>>* devices = MTLCopyAllDevices();
            for (id<MTLDevice> d in devices) {
                if ([[d name] isEqualToString:targetName]) {
                    device = d;  // ARC retains via strong reference
                    break;
                }
            }
        }

        if (!device) {
            device = MTLCreateSystemDefaultDevice();  // +1, ARC-managed
        }
        if (!device) return NULL;

        // ── extract IOSurface ──────────────────────────────────────────
        CVPixelBufferRef pb = (CVPixelBufferRef)cv_pixel_buffer;
        IOSurfaceRef ioSurface = CVPixelBufferGetIOSurface(pb);
        if (!ioSurface) {
            fprintf(stderr, "tribunus_metal_texture_from_iosurface: "
                    "no IOSurface in CVPixelBuffer\n");
            return NULL;
        }

        size_t width = IOSurfaceGetWidth(ioSurface);
        if (width == 0) {
            fprintf(stderr, "tribunus_metal_texture_from_iosurface: "
                    "IOSurface width is 0\n");
            return NULL;
        }

        // ── texture descriptor ─────────────────────────────────────────
        MTLTextureDescriptor* desc =
            [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatR32Float
                                                               width:(NSUInteger)width
                                                              height:1
                                                           mipmapped:NO];
        desc.usage      = MTLTextureUsageShaderWrite;
        desc.storageMode = MTLStorageModePrivate;

        // ── create texture from IOSurface ──────────────────────────────
        id<MTLTexture> texture = [device newTextureWithDescriptor:desc
                                                         iosurface:ioSurface
                                                            plane:0];
        if (!texture) {
            fprintf(stderr, "tribunus_metal_texture_from_iosurface: "
                    "newTextureWithDescriptor failed\n");
            return NULL;
        }

        // Hand off +1 retain to C caller.
        // __bridge_retained bumps retain count; ARC releases the local
        // strong reference (balancing newTextureWithDescriptor's +1), leaving
        // the extra +1 for the void* that the caller owns via
        // tribunus_metal_release_texture / CFBridgingRelease.
        return (__bridge_retained void*)texture;
    }
}

// ── blit copy ─────────────────────────────────────────────────────────────

/// Copy CPU float data into an IOSurface-backed MTLTexture via blit encoder.
/// Synchronous — waits for command buffer completion.
/// Returns 0 on success, negative on error.
int tribunus_metal_dispatch_copy(
    void* texture,
    const float* input_data,
    int element_count
) {
    if (!texture || !input_data || element_count <= 0) return -1;

    @autoreleasepool {
        id<MTLTexture> tex   = (__bridge id<MTLTexture>)texture;
        id<MTLDevice> device = tex.device;

        NSUInteger bytes = (NSUInteger)element_count * sizeof(float);

        // ── source buffer (copies CPU data) ────────────────────────────
        id<MTLBuffer> srcBuffer = [device newBufferWithBytes:input_data
                                                       length:bytes
                                                      options:MTLResourceStorageModeShared];
        if (!srcBuffer) return -2;

        // ── command queue / buffer ─────────────────────────────────────
        id<MTLCommandQueue> queue = [device newCommandQueue];
        if (!queue) return -3;

        id<MTLCommandBuffer> cmdBuf = [queue commandBuffer];
        if (!cmdBuf) return -4;

        // ── blit encoder: buffer → texture ─────────────────────────────
        id<MTLBlitCommandEncoder> blit = [cmdBuf blitCommandEncoder];
        [blit copyFromBuffer:srcBuffer
                sourceOffset:0
          sourceBytesPerRow:(NSUInteger)element_count * sizeof(float)
        sourceBytesPerImage:(NSUInteger)element_count * sizeof(float)
                 sourceSize:MTLSizeMake((NSUInteger)element_count, 1, 1)
                  toTexture:tex
           destinationSlice:0
           destinationLevel:0
          destinationOrigin:MTLOriginMake(0, 0, 0)];
        [blit endEncoding];

        [cmdBuf commit];
        [cmdBuf waitUntilCompleted];

        if (cmdBuf.status == MTLCommandBufferStatusError) {
            fprintf(stderr, "tribunus_metal_dispatch_copy: "
                    "command buffer error %ld\n", (long)cmdBuf.error.code);
            return -5;
        }

        return 0;
    }
}

// ── release ───────────────────────────────────────────────────────────────

/// Release a MTLTexture previously returned by
/// tribunus_metal_texture_from_iosurface.
void tribunus_metal_release_texture(void* texture) {
    if (!texture) return;
    // CFBridgingRelease casts to id and consumes the +1 from __bridge_retained.
    CFBridgingRelease(texture);
}

} // extern "C"
