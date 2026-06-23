use axum::{
    extract::ws::{Message, WebSocket},
    extract::{State, WebSocketUpgrade},
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use sysinfo::{Disks, Networks, System};
use tokio::process::Command;
use tokio::sync::{broadcast, Mutex};
use tokio::time::{interval, Duration};
use tracing::{debug, warn};

const MAX_HISTORY: usize = 60;

#[derive(Serialize, Clone)]
pub struct MonitorData {
    pub cpu: CpuData,
    pub memory: MemoryData,
    pub disk: Vec<DiskData>,
    pub network: Vec<NetworkData>,
    pub gpu: Vec<GpuData>,
}

#[derive(Serialize, Clone)]
pub struct CpuData {
    pub usage: f32,
    pub cores: Vec<f32>,
    pub core_count: CoreCount,
    pub load_avg: [f64; 3],
}

#[derive(Serialize, Clone)]
pub struct CoreCount {
    pub physical: usize,
    pub logical: usize,
}

#[derive(Serialize, Clone)]
pub struct MemoryData {
    pub used: u64,
    pub available: u64,
    pub total: u64,
    pub usage: f64,
    pub swap_used: u64,
    pub swap_total: u64,
}

#[derive(Serialize, Clone)]
pub struct DiskData {
    pub mount: String,
    pub fs_type: String,
    pub used: u64,
    pub available: u64,
    pub total: u64,
    pub usage: f64,
}

#[derive(Serialize, Clone)]
pub struct NetworkData {
    pub name: String,
    pub ip: String,
    pub rx_rate: u64,
    pub tx_rate: u64,
    pub rx_total: u64,
    pub tx_total: u64,
}

#[derive(Serialize, Clone)]
pub struct GpuData {
    pub name: String,
    pub uuid: String,
    pub utilization_gpu: f64,
    pub utilization_mem: f64,
    pub temperature: f64,
    pub power_draw: f64,
    pub power_limit: f64,
    pub fan_speed: f64,
    pub memory_used: u64,
    pub memory_total: u64,
    pub memory_usage: f64,
}

#[derive(Serialize)]
struct HistoryMessage {
    r#type: &'static str,
    data: Vec<MonitorData>,
}

#[derive(Clone)]
pub struct MonitorState {
    history: Arc<Mutex<VecDeque<MonitorData>>>,
    tx: broadcast::Sender<String>,
}

impl MonitorState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel::<String>(8);
        Self {
            history: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_HISTORY))),
            tx,
        }
    }

    pub fn start_collector(self) {
        tokio::spawn(async move {
            let mut sys = System::new_all();
            let mut disks = Disks::new_with_refreshed_list();
            let mut networks = Networks::new_with_refreshed_list();
            let mut prev_net: HashMap<String, (u64, u64)> = HashMap::new();
            let mut tick = interval(Duration::from_secs(2));
            let mut gpu_available: Option<bool> = None;

            sys.refresh_cpu_all();
            tokio::time::sleep(Duration::from_millis(200)).await;

            loop {
                tick.tick().await;

                if gpu_available.is_none() {
                    let available = collect_gpu().await.is_some();
                    gpu_available = Some(available);
                    if available {
                        debug!("GPU monitoring enabled (nvidia-smi detected)");
                    } else {
                        warn!("GPU monitoring disabled (nvidia-smi not available or returned no data)");
                    }
                }

                let (data, new_net) =
                    collect_metrics(&mut sys, &mut disks, &mut networks, &prev_net, 2.0, gpu_available.unwrap_or(false)).await;
                prev_net = new_net;

                let json = match serde_json::to_string(&data) {
                    Ok(j) => j,
                    Err(_) => continue,
                };

                {
                    let mut buf = self.history.lock().await;
                    if buf.len() >= MAX_HISTORY {
                        buf.pop_front();
                    }
                    buf.push_back(data);
                }

                let _ = self.tx.send(json);
            }
        });
    }
}

async fn collect_metrics(
    sys: &mut System,
    disks: &mut Disks,
    networks: &mut Networks,
    prev_net: &HashMap<String, (u64, u64)>,
    elapsed_secs: f64,
    gpu_available: bool,
) -> (MonitorData, HashMap<String, (u64, u64)>) {
    sys.refresh_cpu_all();
    sys.refresh_memory();
    disks.refresh(true);
    networks.refresh(true);

    let cpu = {
        let cores: Vec<f32> = sys.cpus().iter().map(|c| c.cpu_usage()).collect();
        let avg = if cores.is_empty() {
            0.0
        } else {
            cores.iter().sum::<f32>() / cores.len() as f32
        };
        let load = System::load_average();
        CpuData {
            usage: avg,
            cores,
            core_count: CoreCount {
                physical: System::physical_core_count().unwrap_or(0),
                logical: sys.cpus().len(),
            },
            load_avg: [load.one, load.five, load.fifteen],
        }
    };

    let memory = {
        let total = sys.total_memory();
        let used = sys.used_memory();
        let available = sys.available_memory();
        let usage = if total > 0 {
            used as f64 / total as f64 * 100.0
        } else {
            0.0
        };
        MemoryData {
            used,
            available,
            total,
            usage,
            swap_used: sys.used_swap(),
            swap_total: sys.total_swap(),
        }
    };

    let disk: Vec<DiskData> = disks
        .iter()
        .map(|d| {
            let total = d.total_space();
            let available = d.available_space();
            let used = total.saturating_sub(available);
            let usage = if total > 0 {
                used as f64 / total as f64 * 100.0
            } else {
                0.0
            };
            DiskData {
                mount: d.mount_point().to_string_lossy().to_string(),
                fs_type: d.file_system().to_string_lossy().to_string(),
                used,
                available,
                total,
                usage,
            }
        })
        .collect();

    let mut new_net = HashMap::new();
    let network: Vec<NetworkData> = networks
        .iter()
        .filter_map(|(name, data)| {
            let ip = data
                .ip_networks()
                .iter()
                .find(|n| n.addr.is_ipv4() && !n.addr.is_loopback())
                .map(|n| n.addr.to_string())?;

            let rx_total = data.total_received();
            let tx_total = data.total_transmitted();
            let (rx_rate, tx_rate) = if let Some(&(prev_rx, prev_tx)) = prev_net.get(name) {
                let rx = ((rx_total.saturating_sub(prev_rx)) as f64 / elapsed_secs) as u64;
                let tx = ((tx_total.saturating_sub(prev_tx)) as f64 / elapsed_secs) as u64;
                (rx, tx)
            } else {
                (0, 0)
            };
            new_net.insert(name.to_string(), (rx_total, tx_total));

            Some(NetworkData {
                name: name.to_string(),
                ip,
                rx_rate,
                tx_rate,
                rx_total,
                tx_total,
            })
        })
        .collect();

    let gpu = if gpu_available {
        collect_gpu().await.unwrap_or_default()
    } else {
        Vec::new()
    };

    (
        MonitorData {
            cpu,
            memory,
            disk,
            network,
            gpu,
        },
        new_net,
    )
}

fn parse_f64(s: &str) -> f64 {
    let s = s.trim();
    if s.starts_with('[') || s == "N/A" || s == "[N/A]" {
        return 0.0;
    }
    s.trim_end_matches('%')
        .trim_end_matches('W')
        .trim_end_matches('C')
        .trim()
        .parse()
        .unwrap_or(0.0)
}

fn parse_memory(s: &str) -> u64 {
    let s = s.trim();
    if s.starts_with('[') || s == "N/A" || s == "[N/A]" {
        return 0;
    }
    // Handle MiB, GiB, MB, GB suffixes
    if let Some(val) = s.strip_suffix("MiB") {
        return val.trim().parse::<f64>().unwrap_or(0.0) as u64;
    }
    if let Some(val) = s.strip_suffix("GiB") {
        return (val.trim().parse::<f64>().unwrap_or(0.0) * 1024.0) as u64;
    }
    if let Some(val) = s.strip_suffix("MB") {
        return (val.trim().parse::<f64>().unwrap_or(0.0) * 1000.0 / 1024.0) as u64;
    }
    if let Some(val) = s.strip_suffix("GB") {
        return (val.trim().parse::<f64>().unwrap_or(0.0) * 1000.0) as u64;
    }
    s.parse::<f64>().unwrap_or(0.0) as u64
}

async fn collect_gpu() -> Option<Vec<GpuData>> {
    let output = match Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,uuid,utilization.gpu,utilization.memory,temperature.gpu,power.draw,power.limit,fan.speed,memory.used,memory.total",
            "--format=csv,noheader",
        ])
        .output()
        .await
    {
        Ok(o) => o,
        Err(e) => {
            warn!("Failed to spawn nvidia-smi: {e}");
            return None;
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!("nvidia-smi exited with {}: {}", output.status, stderr.trim());
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let gpus: Vec<GpuData> = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let fields: Vec<&str> = line.split(',').collect();
            if fields.len() < 10 {
                warn!("nvidia-smi: expected >=10 fields, got {} in: {}", fields.len(), line.trim());
                return None;
            }
            let memory_used = parse_memory(fields[8]);
            let memory_total = parse_memory(fields[9]);
            let memory_usage = if memory_total > 0 {
                memory_used as f64 / memory_total as f64 * 100.0
            } else {
                0.0
            };
            Some(GpuData {
                name: fields[0].trim().to_string(),
                uuid: fields[1].trim().to_string(),
                utilization_gpu: parse_f64(fields[2]),
                utilization_mem: parse_f64(fields[3]),
                temperature: parse_f64(fields[4]),
                power_draw: parse_f64(fields[5]),
                power_limit: parse_f64(fields[6]),
                fan_speed: parse_f64(fields[7]),
                memory_used,
                memory_total,
                memory_usage,
            })
        })
        .collect();

    if gpus.is_empty() {
        warn!("nvidia-smi returned no valid GPU data. Raw output: {}", stdout.trim());
        None
    } else {
        debug!("Collected {} GPU(s)", gpus.len());
        Some(gpus)
    }
}

pub async fn ws_monitor_handler(
    State(state): State<MonitorState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_monitor_socket(socket, state))
}

async fn handle_monitor_socket(socket: WebSocket, state: MonitorState) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Send buffered history as first message
    {
        let buf = state.history.lock().await;
        if !buf.is_empty() {
            let msg = HistoryMessage {
                r#type: "history",
                data: buf.iter().cloned().collect(),
            };
            if let Ok(json) = serde_json::to_string(&msg) {
                if ws_tx.send(Message::Text(json.into())).await.is_err() {
                    return;
                }
            }
        }
    }

    let mut rx = state.tx.subscribe();

    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(json) => {
                    if ws_tx.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    });

    while let Some(Ok(msg)) = ws_rx.next().await {
        if let Message::Close(_) = msg {
            break;
        }
    }

    send_task.abort();
}
