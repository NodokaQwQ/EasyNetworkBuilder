package tasks

import (
	"errors"
	"fmt"

	"github.com/nuomiiiii/lite/database/models"
	"github.com/nuomiiiii/lite/database/notificationdefaults"
	"gorm.io/gorm"
)

func validateReturnRoutePingInterval(interval, routeInterval int) error {
	if interval < 0 || interval > routeInterval {
		return fmt.Errorf("延迟监测间隔须为 0（跟随回程）或 1 至 %d 秒", routeInterval)
	}
	return nil
}

// syncReturnRoutePing runs in the same transaction as the route mutation. Each
// route owns its monitor, so existing/manual monitors are never repurposed.
func syncReturnRoutePing(tx *gorm.DB, task *models.ReturnRouteTask) error {
	interval := task.PingInterval
	if interval == 0 {
		interval = task.Interval
	}
	clients := models.StringArray{}
	if task.Enabled {
		clients = append(clients, task.Client)
	}
	var ping models.PingTask
	err := tx.Where("return_route_task_id = ?", task.Id).First(&ping).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		ping = models.PingTask{Name: task.Name, Type: "icmp", Target: task.Target,
			Clients: clients, Interval: interval, ReturnRouteTaskID: &task.Id}
		if err := tx.Create(&ping).Error; err != nil {
			return err
		}
		if err := tx.Model(&ping).Update("weight", int(ping.Id)).Error; err != nil {
			return err
		}
	} else {
		// A new target/node is a new measurement series. Do not mix old history
		// or learned baselines into it: retire the old monitor and create anew.
		if ping.Target != task.Target || (len(ping.Clients) > 0 && !ping.AppliesToClient(task.Client)) {
			if mainlandPingTaskID(*task) == ping.Id {
				task.MainlandReachabilityPingTaskID = nil
			}
			if err := deletePingTaskRows(tx, []uint{ping.Id}); err != nil {
				return err
			}
			return syncReturnRoutePing(tx, task)
		}
		if err := tx.Model(&ping).Updates(map[string]any{
			"name": task.Name, "type": "icmp", "target": task.Target,
			"clients": clients, "interval": interval, "all_clients": false,
		}).Error; err != nil {
			return err
		}
	}
	// An explicitly chosen auxiliary monitor remains supported. Otherwise the
	// auto-created monitor is also the mainland reachability evidence source.
	if task.MainlandReachabilityPingTaskID == nil {
		task.MainlandReachabilityPingTaskID = &ping.Id
		return tx.Model(task).Update("mainland_reachability_ping_task_id", ping.Id).Error
	}
	return nil
}

func applyReturnRoutePingDefaults(db *gorm.DB) error {
	loss, err := notificationdefaults.GetPingLossNotificationDefaultConfig()
	if err != nil {
		return err
	}
	latency, err := notificationdefaults.GetLatencyAnomalyNotificationDefaultConfig()
	if err != nil {
		return err
	}
	var pings []models.PingTask
	if err := db.Where("return_route_task_id IS NOT NULL").Find(&pings).Error; err != nil {
		return err
	}
	for _, ping := range pings {
		if err := notificationdefaults.ApplyLoadedPingHealthDefaultsToTaskClients(db, loss, latency, ping.Id, ping.Clients); err != nil {
			return err
		}
	}
	return nil
}

func ensurePingTaskNotManaged(db *gorm.DB, ids []uint) error {
	var count int64
	if err := db.Model(&models.PingTask{}).Where("id IN ? AND return_route_task_id IS NOT NULL", ids).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("回程关联的延迟监测由回程任务管理，请在回程线路检测中修改或删除")
	}
	return nil
}

// reconcileReturnRoutePings also upgrades existing tasks on startup. Orphaned
// monitors (e.g. after deleting a node) are retired without touching manual ones.
func reconcileReturnRoutePings(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var orphanIDs []uint
		if err := tx.Model(&models.PingTask{}).
			Where("return_route_task_id IS NOT NULL AND return_route_task_id NOT IN (?)", tx.Model(&models.ReturnRouteTask{}).Select("id")).
			Pluck("id", &orphanIDs).Error; err != nil {
			return err
		}
		if len(orphanIDs) > 0 {
			if err := deletePingTaskRows(tx, orphanIDs); err != nil {
				return err
			}
		}
		var routes []models.ReturnRouteTask
		if err := tx.Find(&routes).Error; err != nil {
			return err
		}
		for i := range routes {
			if err := syncReturnRoutePing(tx, &routes[i]); err != nil {
				return err
			}
		}
		return nil
	})
}
