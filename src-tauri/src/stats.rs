// CPU, memory and network from sysinfo; the NVIDIA GPU from NVML (part of the
// NVIDIA driver). Anything that can't be read is sent as null, never as 0.

use nvml_wrapper::{enum_wrappers::device::TemperatureSensor, Nvml};
use serde::Serialize;
use std::time::Instant;
use sysinfo::{Networks, System};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    cpu: f32,
    ram_used: u64,
    ram_total: u64,
    gpu: Option<u32>,
    gpu_temp: Option<u32>,
    down: f64, // bytes per second
    up: f64,
}

pub struct Stats {
    sys: System,
    nets: Networks,
    last: Instant,
    nvml: Option<Nvml>,
}

impl Stats {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_usage(); // CPU usage needs two samples; this is the first
        Self { sys, nets: Networks::new_with_refreshed_list(), last: Instant::now(), nvml: Nvml::init().ok() }
    }

    pub fn snapshot(&mut self) -> Snapshot {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        self.nets.refresh(true);
        let secs = self.last.elapsed().as_secs_f64().max(0.001);
        self.last = Instant::now();

        let (mut rx, mut tx) = (0u64, 0u64);
        for (name, data) in self.nets.iter() {
            if name.to_lowercase().contains("loopback") {
                continue;
            }
            rx += data.received();
            tx += data.transmitted();
        }

        let (gpu, gpu_temp) = match self.nvml.as_ref().and_then(|n| n.device_by_index(0).ok()) {
            Some(d) => (
                d.utilization_rates().ok().map(|u| u.gpu),
                d.temperature(TemperatureSensor::Gpu).ok(),
            ),
            None => (None, None),
        };

        Snapshot {
            cpu: self.sys.global_cpu_usage(),
            ram_used: self.sys.used_memory(),
            ram_total: self.sys.total_memory(),
            gpu,
            gpu_temp,
            down: rx as f64 / secs,
            up: tx as f64 / secs,
        }
    }
}
