#[cfg(test)]
mod tests {
    use tribunus_compute_core::backend::zenblas::{CPUDispatch, matmul_f32, matmul_int8, get_dispatch};
    
    #[test]
    fn test_cpu_matmul_f32_conformance() {
        let m = 2;
        let n = 2;
        let k = 2;
        let a = vec![1.0, 2.0, 3.0, 4.0];
        let b = vec![5.0, 6.0, 7.0, 8.0];
        let mut c = vec![0.0; 4];
        
        matmul_f32(m, n, k, &a, &b, &mut c);
        
        // [1 2] * [5 6] = [19 22]
        // [3 4]   [7 8]   [43 50]
        assert_eq!(c, vec![19.0, 22.0, 43.0, 50.0]);
    }
    
    #[test]
    fn test_cpu_matmul_int8_conformance() {
        let m = 2;
        let n = 2;
        let k = 2;
        let a = vec![1, 2, 3, 4];
        let b = vec![5, 6, 7, 8];
        let mut c = vec![0; 4];
        
        matmul_int8(m, n, k, &a, &b, &mut c);
        
        assert_eq!(c, vec![19, 22, 43, 50]);
    }

    #[test]
    fn test_dispatch_detection() {
        let dispatch = get_dispatch();
        // Since we are running in an unknown test environment, we just ensure it evaluates to something valid
        assert!(matches!(
            dispatch,
            CPUDispatch::Scalar | CPUDispatch::Avx2 | CPUDispatch::AmxTile | CPUDispatch::OpenBLAS
        ));
    }
}
