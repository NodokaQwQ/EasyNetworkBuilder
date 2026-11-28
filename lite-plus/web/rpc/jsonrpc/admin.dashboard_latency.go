package jsonrpc

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/nuomiiiii/lite/database/metricstore"
	"github.com/nuomiiiii/lite/database/models"
	"github.com/nuomiiiii/lite/pkg/metric"
)

type dashboardLatencyPoint struct {
	Time     time.Time `json:"time"`
	Average  float64   `json:"average"`
	LossRate float64   `json:"loss_rate"`
}

type dashboardLatencySummary struct {
	Average       float64                          `json:"average"`
	AverageLoss   float64                          `json:"average_loss"`
	Targets       int                              `json:"targets"`
	Points        []dashboardLatencyPoint          `json:"points"`
	Ranking       []dashboardLatencyRankItem       `json:"ranking"`
	JitterRanking []dashboardLatencyJitterRankItem `json:"jitter_ranking"`
	JitterError   string                           `json:"jitter_error,omitempty"`
	Error         string                           `json:"error,omitempty"`
}

type dashboardLatencyRankItem struct {
	UUID        string  `json:"uuid"`
	Name        string  `json:"name"`
	Average     float64 `json:"average"`
	TaskID      uint    `json:"task_id,omitempty"`
	TaskName    string  `json:"task_name,omitempty"`
	DetailURL   string  `json:"detail_url,omitempty"`
	clientOrder int     `json:"-"`
}

type dashboardLatencyJitterRankItem struct {
	UUID        string  `json:"uuid"`
	Name        string  `json:"name"`
	Previous    float64 `json:"previous"`
	Current     float64 `json:"current"`
	Delta       float64 `json:"delta"`
	TaskID      uint    `json:"task_id,omitempty"`
	TaskName    string  `json:"task_name,omitempty"`
	DetailURL   string  `json:"detail_url,omitempty"`
	clientOrder int     `json:"-"`
}

type dashboardLatencyBucket struct {
	Sum   float64
	Count int
}

const dashboardLatencyJitterLookback = 10 * time.Minute

func loadDashboardLatency(ctx context.Context, clientList []models.Client, pingTasks []models.PingTask, now time.Time, rankingLimit int) (dashboardLatencySummary, error) {
	result := dashboardLatencySummary{Targets: len(pingTasks)}
	store := metricstore.GetStore()
	if store == nil {
		return result, fmt.Errorf("metric store is not initialized")
	}
	start := now.Add(-6 * time.Hour)
	interval := store.CompatibleSeriesIntervalForMetric(ctx, metricstore.MetricPingLatency, start, now, 15*time.Minute)
	batch, err := store.DashboardSeriesBatch(ctx, []metric.AggregateQuery{
		{
			Query: metric.Query{
				MetricName: metricstore.MetricPingLatency,
				Start:      start,
				End:        now,
				Order:      metric.OrderAsc,
			},
			Aggregation:                   metric.AggAvg,
			Interval:                      interval,
			PreserveSeries:                true,
			ClosedBucketsFromMatchingTier: true,
		},
		{
			Query: metric.Query{
				MetricName: metricstore.MetricPingLoss,
				Start:      start,
				End:        now,
				Order:      metric.OrderAsc,
			},
			Aggregation:                   metric.AggAvg,
			Interval:                      interval,
			PreserveSeries:                true,
			ClosedBucketsFromMatchingTier: true,
		},
	}, now)
	if err != nil {
		return result, fmt.Errorf("query six-hour latency and packet loss window: %w", err)
	}
	var latencySeries, lossSeries []metric.AggregatePoint
	if len(batch) > 0 {
		latencySeries = batch[0]
	}
	if len(batch) > 1 {
		lossSeries = batch[1]
	}

	result.Ranking = summarizeDashboardLatencyRanking(clientList, pingTasks, latencySeries, rankingLimit)
	points, avgLat, avgLoss := summarizeDashboardLatencyAndLossPoints(clientList, latencySeries, lossSeries)
	result.Points = points
	result.Average = avgLat
	result.AverageLoss = avgLoss
	return result, nil
}

func summarizeDashboardLatencyAndLossPoints(
	clientList []models.Client,
	latencySeries, lossSeries []metric.AggregatePoint,
) ([]dashboardLatencyPoint, float64, float64) {
	clientsByID := make(map[string]struct{}, len(clientList))
	for _, client := range clientList {
		clientsByID[client.UUID] = struct{}{}
	}
	type combinedBucket struct {
		latSum    float64
		latCount  int
		lossSum   float64
		lossCount int
	}
	buckets := make(map[time.Time]combinedBucket)
	for _, point := range latencySeries {
		if point.Count <= 0 {
			continue
		}
		if _, ok := clientsByID[point.EntityID]; !ok {
			continue
		}
		bucketTime := point.Bucket.UTC()
		b := buckets[bucketTime]
		if point.Value < 0 {
			// Sentinel fallback if lossSeries was empty
			if len(lossSeries) == 0 {
				b.lossSum += float64(point.Count)
				b.lossCount += point.Count
			}
		} else {
			b.latSum += point.Value * float64(point.Count)
			b.latCount += point.Count
			if len(lossSeries) == 0 {
				b.lossCount += point.Count
			}
		}
		buckets[bucketTime] = b
	}
	for _, point := range lossSeries {
		if point.Count <= 0 || math.IsNaN(point.Value) || math.IsInf(point.Value, 0) {
			continue
		}
		if _, ok := clientsByID[point.EntityID]; !ok {
			continue
		}
		ratio := math.Max(0, math.Min(1, point.Value))
		bucketTime := point.Bucket.UTC()
		b := buckets[bucketTime]
		b.lossSum += ratio * float64(point.Count)
		b.lossCount += point.Count
		buckets[bucketTime] = b
	}

	times := make([]time.Time, 0, len(buckets))
	for bucketTime := range buckets {
		times = append(times, bucketTime)
	}
	sort.Slice(times, func(i, j int) bool { return times[i].Before(times[j]) })

	points := make([]dashboardLatencyPoint, 0, len(times))
	var totalLatSum, totalLossSum float64
	var totalLatCount, totalLossCount int
	for _, bucketTime := range times {
		b := buckets[bucketTime]
		if b.latCount <= 0 && b.lossCount <= 0 {
			continue
		}
		avgLat := 0.0
		if b.latCount > 0 {
			avgLat = metricstore.RoundLatencyMS(b.latSum / float64(b.latCount))
			totalLatSum += b.latSum
			totalLatCount += b.latCount
		}
		lossPct := 0.0
		if b.lossCount > 0 {
			lossPct = metricstore.RoundLatencyMS(b.lossSum / float64(b.lossCount) * 100)
			totalLossSum += b.lossSum
			totalLossCount += b.lossCount
		}
		points = append(points, dashboardLatencyPoint{
			Time:     bucketTime,
			Average:  avgLat,
			LossRate: lossPct,
		})
	}
	overallLat := 0.0
	if totalLatCount > 0 {
		overallLat = metricstore.RoundLatencyMS(totalLatSum / float64(totalLatCount))
	}
	overallLoss := 0.0
	if totalLossCount > 0 {
		overallLoss = metricstore.RoundLatencyMS(totalLossSum / float64(totalLossCount) * 100)
	}
	return points, overallLat, overallLoss
}

func summarizeDashboardLatencyRanking(clientList []models.Client, taskList []models.PingTask, series []metric.AggregatePoint, rankingLimit int) []dashboardLatencyRankItem {
	tasksByID := make(map[uint]models.PingTask, len(taskList))
	for _, task := range taskList {
		tasksByID[task.Id] = task
	}
	aggregates := make(map[dashboardLatencyJitterKey]dashboardLatencyBucket, len(series))
	for _, point := range series {
		if point.Count <= 0 || point.Value < 0 {
			continue
		}
		taskID, ok := dashboardLatencyTaskID(point)
		if !ok {
			continue
		}
		if _, ok := tasksByID[taskID]; !ok {
			continue
		}
		key := dashboardLatencyJitterKey{client: point.EntityID, taskID: taskID}
		bucket := aggregates[key]
		bucket.Sum += point.Value * float64(point.Count)
		bucket.Count += point.Count
		aggregates[key] = bucket
	}
	result := make([]dashboardLatencyRankItem, 0, rankingLimit)
	for clientOrder, client := range clientList {
		for _, task := range taskList {
			if !task.AppliesToClient(client.UUID) {
				continue
			}
			bucket := aggregates[dashboardLatencyJitterKey{client: client.UUID, taskID: task.Id}]
			if bucket.Count <= 0 {
				continue
			}
			result = dashboardTopLatency(result, dashboardLatencyRankItem{
				UUID:        client.UUID,
				Name:        dashboardNodeName(client),
				Average:     metricstore.RoundLatencyMS(bucket.Sum / float64(bucket.Count)),
				TaskID:      task.Id,
				TaskName:    dashboardTaskName(task),
				clientOrder: clientOrder,
			}, rankingLimit)
		}
	}
	return result
}

func dashboardLatencyRankBefore(left, right dashboardLatencyRankItem) bool {
	if left.Average != right.Average {
		return left.Average > right.Average
	}
	if left.Name != right.Name {
		return left.Name < right.Name
	}
	if left.TaskName != right.TaskName {
		return left.TaskName < right.TaskName
	}
	return left.clientOrder < right.clientOrder
}

func dashboardTopLatency(top []dashboardLatencyRankItem, item dashboardLatencyRankItem, limit int) []dashboardLatencyRankItem {
	return dashboardInsertRanked(top, item, limit, dashboardLatencyRankBefore)
}

func loadDashboardLatencyJitter(ctx context.Context, clientList []models.Client, pingTasks []models.PingTask, now time.Time, rankingLimit int) ([]dashboardLatencyJitterRankItem, error) {
	store := metricstore.GetStore()
	if store == nil {
		return nil, fmt.Errorf("metric store is not initialized")
	}
	if len(pingTasks) == 0 || len(clientList) == 0 {
		return []dashboardLatencyJitterRankItem{}, nil
	}
	currentMinute := now.UTC().Truncate(time.Minute)
	series, err := store.DashboardSeries(ctx, metric.AggregateQuery{
		Query: metric.Query{
			MetricName: metricstore.MetricPingLatency,
			Start:      currentMinute.Add(-dashboardLatencyJitterLookback),
			End:        now,
			Order:      metric.OrderAsc,
		},
		Aggregation:    metric.AggAvg,
		Interval:       time.Minute,
		PreserveSeries: true,
	}, now)
	if err != nil {
		return nil, fmt.Errorf("query latency jitter window: %w", err)
	}
	return summarizeDashboardLatencyJitter(clientList, pingTasks, series, currentMinute, rankingLimit), nil
}

type dashboardLatencyJitterKey struct {
	client string
	taskID uint
}

func summarizeDashboardLatencyJitter(clientList []models.Client, taskList []models.PingTask, series []metric.AggregatePoint, currentMinute time.Time, rankingLimit int) []dashboardLatencyJitterRankItem {
	tasksByID := make(map[uint]models.PingTask, len(taskList))
	for _, task := range taskList {
		tasksByID[task.Id] = task
	}
	pointsBySeries := make(map[dashboardLatencyJitterKey][]metric.AggregatePoint, len(series))
	for _, point := range series {
		taskID, ok := dashboardLatencyTaskID(point)
		if !ok {
			continue
		}
		if _, ok := tasksByID[taskID]; !ok {
			continue
		}
		key := dashboardLatencyJitterKey{client: point.EntityID, taskID: taskID}
		pointsBySeries[key] = append(pointsBySeries[key], point)
	}
	result := make([]dashboardLatencyJitterRankItem, 0, rankingLimit)
	for clientOrder, client := range clientList {
		for _, task := range taskList {
			if !task.AppliesToClient(client.UUID) {
				continue
			}
			previous, current, ok := dashboardLatestLatencyMinuteAverages(pointsBySeries[dashboardLatencyJitterKey{client: client.UUID, taskID: task.Id}], currentMinute)
			if !ok {
				continue
			}
			result = dashboardTopLatencyJitter(result, dashboardLatencyJitterRankItem{
				UUID:        client.UUID,
				Name:        dashboardNodeName(client),
				Previous:    previous,
				Current:     current,
				Delta:       metricstore.RoundLatencyMS(current - previous),
				TaskID:      task.Id,
				TaskName:    dashboardTaskName(task),
				clientOrder: clientOrder,
			}, rankingLimit)
		}
	}
	return result
}

func dashboardLatencyTaskID(point metric.AggregatePoint) (uint, bool) {
	value, err := strconv.ParseUint(strings.TrimSpace(point.Tags["task_id"]), 10, 64)
	return uint(value), err == nil && value > 0
}

func dashboardLatestLatencyMinuteAverages(points []metric.AggregatePoint, currentMinute time.Time) (float64, float64, bool) {
	buckets := dashboardLatencyMinuteBuckets(points)
	for later := currentMinute; !later.Before(currentMinute.Add(-dashboardLatencyJitterLookback)); later = later.Add(-time.Minute) {
		earlier := later.Add(-time.Minute)
		previous, previousOK := buckets[earlier]
		current, currentOK := buckets[later]
		if !previousOK || !currentOK || previous.Count == 0 || current.Count == 0 {
			continue
		}
		previousAverage := metricstore.RoundLatencyMS(previous.Sum / float64(previous.Count))
		currentAverage := metricstore.RoundLatencyMS(current.Sum / float64(current.Count))
		return previousAverage, currentAverage, true
	}
	return 0, 0, false
}

func dashboardLatencyMinuteBuckets(points []metric.AggregatePoint) map[time.Time]dashboardLatencyBucket {
	buckets := make(map[time.Time]dashboardLatencyBucket)
	for _, point := range points {
		if point.Count <= 0 || point.Value < 0 {
			continue
		}
		bucket := point.Bucket.UTC().Truncate(time.Minute)
		value := buckets[bucket]
		value.Sum += point.Value * float64(point.Count)
		value.Count += point.Count
		buckets[bucket] = value
	}
	return buckets
}

func dashboardLatencyJitterBefore(left, right dashboardLatencyJitterRankItem) bool {
	if left.Delta != right.Delta {
		return left.Delta > right.Delta
	}
	if left.Name != right.Name {
		return left.Name < right.Name
	}
	if left.TaskName != right.TaskName {
		return left.TaskName < right.TaskName
	}
	return left.clientOrder < right.clientOrder
}

func dashboardTopLatencyJitter(top []dashboardLatencyJitterRankItem, item dashboardLatencyJitterRankItem, limit int) []dashboardLatencyJitterRankItem {
	return dashboardInsertRanked(top, item, limit, dashboardLatencyJitterBefore)
}
