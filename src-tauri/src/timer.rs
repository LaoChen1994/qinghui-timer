use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timer {
    pub id: u64,
    pub name: String,
    pub minutes: u32,
    pub started_at: u64,
    pub deadline: u64,
    pub warned: bool,
    pub refreshed: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AlertKind {
    Warning,
    Ready,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    pub id: String,
    pub timer_id: u64,
    pub name: String,
    pub kind: AlertKind,
    pub deadline: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub timers: Vec<Timer>,
    pub alerts: Vec<Alert>,
    pub next_id: u64,
}

impl Store {
    pub fn add(&mut self, name: &str, minutes: u32, now: u64) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 40 {
            return Err("请输入 1～40 个字符的怪物名称".into());
        }
        if !(1..=1440).contains(&minutes) {
            return Err("刷新周期须为 1～1440 的整数分钟".into());
        }
        self.next_id += 1;
        self.timers.push(Timer {
            id: self.next_id,
            name: name.into(),
            minutes,
            started_at: now,
            deadline: now + u64::from(minutes) * 60_000,
            warned: false,
            refreshed: false,
        });
        Ok(())
    }

    pub fn reset(&mut self, id: u64, now: u64) -> Result<(), String> {
        let timer = self
            .timers
            .iter_mut()
            .find(|timer| timer.id == id)
            .ok_or("这只怪物的计时记录已不存在")?;
        timer.started_at = now;
        timer.deadline = now + u64::from(timer.minutes) * 60_000;
        timer.warned = false;
        timer.refreshed = false;
        self.alerts.retain(|alert| alert.timer_id != id);
        Ok(())
    }

    pub fn remove(&mut self, id: u64) -> Result<(), String> {
        if !self.timers.iter().any(|timer| timer.id == id) {
            return Err("这只怪物的计时记录已不存在".into());
        }
        self.timers.retain(|timer| timer.id != id);
        self.alerts.retain(|alert| alert.timer_id != id);
        Ok(())
    }

    pub fn adjust(&mut self, id: u64, seconds: i32, now: u64) -> Result<(), String> {
        if ![-60, -10, 10, 60].contains(&seconds) {
            return Err("请选择增加或减少 10 秒／1 分钟".into());
        }
        let timer = self
            .timers
            .iter_mut()
            .find(|timer| timer.id == id)
            .ok_or("这只怪物的计时记录已不存在")?;
        let deadline = if seconds < 0 {
            timer
                .deadline
                .max(now)
                .saturating_sub(u64::from(seconds.unsigned_abs()) * 1_000)
                .max(now)
                .max(timer.started_at)
        } else {
            timer
                .deadline
                .max(now)
                .checked_add(u64::from(seconds.unsigned_abs()) * 1_000)
                .filter(|deadline| *deadline <= 8_640_000_000_000_000)
                .ok_or("刷新时间超出支持范围")?
        };
        let within_warning = deadline > now && deadline - now <= 180_000;
        timer.warned = timer.warned
            && timer.deadline > now
            && timer.deadline - now <= 180_000
            && within_warning;
        timer.refreshed = timer.refreshed && deadline <= now;
        timer.deadline = deadline;
        self.alerts.retain_mut(|alert| {
            if alert.timer_id != id {
                return true;
            }
            if (within_warning && timer.warned && alert.kind == AlertKind::Warning)
                || (deadline <= now && timer.refreshed && alert.kind == AlertKind::Ready)
            {
                alert.deadline = deadline;
                alert.id = format!("{}:{}:{:?}", id, deadline, alert.kind);
                true
            } else {
                false
            }
        });
        Ok(())
    }

    pub fn advance(&mut self, now: u64) -> Vec<Alert> {
        let mut notifications = Vec::new();
        for timer in &mut self.timers {
            let kind = if now >= timer.deadline && !timer.refreshed {
                timer.refreshed = true;
                timer.warned = true;
                // 休眠跨过刷新时刻时，只保留有效的到点提醒。
                self.alerts.retain(|alert| alert.timer_id != timer.id);
                Some(AlertKind::Ready)
            } else if now < timer.deadline && timer.deadline - now <= 180_000 && !timer.warned {
                timer.warned = true;
                Some(AlertKind::Warning)
            } else {
                None
            };
            if let Some(kind) = kind {
                let alert = Alert {
                    id: format!("{}:{}:{:?}", timer.id, timer.deadline, kind),
                    timer_id: timer.id,
                    name: timer.name.clone(),
                    kind,
                    deadline: timer.deadline,
                };
                self.alerts.push(alert.clone());
                notifications.push(alert);
            }
        }
        notifications
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiple_timers_and_same_names_remain_independent() {
        let mut store = Store::default();
        for minutes in [40, 60, 90, 137] {
            store.add("  逆魔  ", minutes, 1_000).unwrap();
        }
        assert_eq!(store.timers.len(), 4);
        assert_eq!(store.timers[0].name, "逆魔");
        assert_eq!(store.timers[3].deadline, 8_221_000);
        store.reset(1, 10_000).unwrap();
        assert_eq!(store.timers[0].deadline, 2_410_000);
        assert_eq!(store.timers[1].started_at, 1_000);
        store.remove(2).unwrap();
        assert_eq!(store.timers.len(), 3);
        assert_eq!(store.timers[1].id, 3);
    }

    #[test]
    fn invalid_values_do_not_create_records() {
        let mut store = Store::default();
        for name in ["", "   ", &"王".repeat(41)] {
            assert!(store.add(name, 40, 0).is_err());
        }
        for minutes in [0, 1441, u32::MAX] {
            assert!(store.add("逆魔", minutes, 0).is_err());
        }
        assert!(store.timers.is_empty());
        assert_eq!(store.next_id, 0);
        assert!(store.reset(1, 0).is_err());
        assert!(store.remove(1).is_err());
    }

    #[test]
    fn reminders_fire_once_at_both_boundaries() {
        let mut store = Store::default();
        store.add("禁地魔王", 40, 0).unwrap();
        assert!(store.advance(2_219_999).is_empty());
        assert_eq!(store.advance(2_220_000)[0].kind, AlertKind::Warning);
        assert!(store.advance(2_220_001).is_empty());
        assert!(store.advance(2_399_999).is_empty());
        assert_eq!(store.advance(2_400_000)[0].kind, AlertKind::Ready);
        assert_eq!(store.alerts.len(), 1);
        assert!(store.advance(2_500_000).is_empty());
        assert_eq!(store.timers[0].deadline, 2_400_000);
    }

    #[test]
    fn short_timers_warn_immediately_and_reset_rearms_reminders() {
        let mut store = Store::default();
        store.add("逆魔", 1, 1_000).unwrap();
        assert_eq!(store.advance(1_000)[0].kind, AlertKind::Warning);
        assert_eq!(store.advance(61_000)[0].kind, AlertKind::Ready);
        store.reset(1, 70_000).unwrap();
        assert!(store.alerts.is_empty());
        assert!(!store.timers[0].refreshed);
        assert_eq!(store.advance(70_000)[0].kind, AlertKind::Warning);
        assert_eq!(store.advance(130_000)[0].kind, AlertKind::Ready);
    }

    #[test]
    fn restart_preserves_deadlines_and_deduplication_flags() {
        let mut store = Store::default();
        store.add("通天教主", 90, 0).unwrap();
        store.advance(5_220_000);
        let json = serde_json::to_string(&store).unwrap();
        let mut restored: Store = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.timers[0].deadline, 5_400_000);
        assert!(restored.advance(5_230_000).is_empty());
        assert_eq!(restored.advance(5_400_000)[0].kind, AlertKind::Ready);
        let json = serde_json::to_string(&restored).unwrap();
        let mut restored: Store = serde_json::from_str(&json).unwrap();
        assert!(restored.advance(5_500_000).is_empty());
    }

    #[test]
    fn sleep_or_offline_recovery_skips_obsolete_warnings() {
        let mut store = Store::default();
        store.add("逆魔", 40, 0).unwrap();
        store.add("禁地魔王", 60, 0).unwrap();
        let alerts = store.advance(3_800_000);
        assert_eq!(alerts.len(), 2);
        assert!(alerts.iter().all(|alert| alert.kind == AlertKind::Ready));
        assert!(store.advance(3_900_000).is_empty());
    }

    #[test]
    fn deleting_a_timer_cancels_its_pending_reminders() {
        let mut store = Store::default();
        store.add("逆魔", 3, 0).unwrap();
        store.add("通天教主", 3, 0).unwrap();
        store.advance(0);
        store.remove(1).unwrap();
        assert_eq!(store.alerts.len(), 1);
        assert_eq!(store.alerts[0].timer_id, 2);
        assert_eq!(store.advance(180_000).len(), 1);
    }

    #[test]
    fn adjustments_keep_the_cycle_start_and_other_timers_and_survive_restart() {
        let mut store = Store::default();
        store.add("逆魔", 45, 1_000).unwrap();
        store.add("通天教主", 60, 1_000).unwrap();
        for seconds in [10, 60, -10, -60] {
            store.adjust(1, seconds, 2_000).unwrap();
        }
        assert_eq!(store.timers[0].deadline, 2_701_000);
        store.adjust(1, 60, 2_000).unwrap();
        assert_eq!(store.timers[0].started_at, 1_000);
        assert_eq!(store.timers[0].minutes, 45);
        assert_eq!(store.timers[1].deadline, 3_601_000);
        let json = serde_json::to_string(&store).unwrap();
        let mut restored: Store = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.timers[0].deadline, 2_761_000);
        restored.reset(1, 10_000).unwrap();
        assert_eq!(restored.timers[0].deadline, 2_710_000);
    }

    #[test]
    fn adjustments_clamp_at_zero_and_rearm_reminders_without_repeated_warnings() {
        let mut store = Store::default();
        store.add("逆魔", 1, 1_000).unwrap();
        store.adjust(1, -60, 31_000).unwrap();
        assert_eq!(store.timers[0].deadline, 31_000);
        assert_eq!(store.advance(31_000)[0].kind, AlertKind::Ready);
        assert!(store.advance(31_000).is_empty());
        store.adjust(1, 10, 32_000).unwrap();
        assert_eq!(store.timers[0].deadline, 42_000);
        assert!(store.alerts.is_empty());
        assert_eq!(store.advance(32_000)[0].kind, AlertKind::Warning);
        store.adjust(1, 60, 32_000).unwrap();
        assert_eq!(store.alerts[0].deadline, 102_000);
        assert!(store.alerts[0].id.contains("102000"));
        assert!(store.advance(32_000).is_empty());
        store.alerts.clear();
        store.adjust(1, -10, 32_000).unwrap();
        assert!(store.advance(32_000).is_empty());
        for _ in 0..3 {
            store.adjust(1, 60, 32_000).unwrap();
        }
        assert!(!store.timers[0].warned);
        store.adjust(1, -60, 32_000).unwrap();
        assert_eq!(store.advance(32_000)[0].kind, AlertKind::Warning);
        store.adjust(1, 60, 32_000).unwrap();
        assert!(store.alerts.is_empty());
        assert!(store.advance(32_000).is_empty());
    }

    #[test]
    fn invalid_adjustments_do_not_modify_timers() {
        let mut store = Store::default();
        store.add("逆魔", 45, 1_000).unwrap();
        assert!(store.adjust(1, 1, 2_000).is_err());
        assert!(store.adjust(99, 60, 2_000).is_err());
        assert_eq!(store.timers[0].deadline, 2_701_000);
        store.timers[0].deadline = 8_640_000_000_000_000;
        assert!(store.adjust(1, 10, 2_000).is_err());
        assert_eq!(store.timers[0].deadline, 8_640_000_000_000_000);
    }
}
