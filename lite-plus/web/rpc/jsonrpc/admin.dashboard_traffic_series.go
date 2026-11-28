package jsonrpc

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nuomiiiii/lite/database/clients"
	"github.com/nuomiiiii/lite/database/dbcore"
	"github.com/nuomiiiii/lite/database/metricstore"
	"github.com/nuomiiiii/lite/database/models"
	"github.com/nuomiiiii/lite/database/trafficledger"
	"github.com/nuomiiiii/lite/pkg/rpc"
	"github.com/nuomiiiii/lite/pkg/timeutil"
)

type dashboardTrafficSeriesUsage struct {
	Up    int64 `json:"up"`
	Down  int64 `json:"down"`
	Total int64 `json:"total"`
}

type dashboardTrafficSeriesBucket struct {
	Start    time.Time                              `json:"start"`
	End      time.Time                              `json:"end"`
	Label    string                                 `json:"label"`
	Up       int64                                  `json:"up"`
	Down     int64                                  `json:"down"`
	Total    int64                                  `json:"total"`
	ByServer map[string]dashboardTrafficSeriesUsage `json:"by_server,omitempty"`
}

type dashboardTrafficSeriesResponse struct {
	Granularity string                         `json:"granularity"`
	Servers     []dashboardTrafficServerMeta   `json:"servers"`
	Buckets     []dashboardTrafficSeriesBucket `json:"buckets"`
	GeneratedAt time.Time                      `json:"generated_at"`
}

var dashboardTrafficSeriesCache dashboardModuleCache[dashboardTrafficSeriesResponse]

func init() {
	RegisterWithGroupAndMeta("getDashboardTrafficSeries", rpc.RoleAdmin, adminGetDashboardTrafficSeries, &rpc.MethodMeta{
		Name:    "admin:getDashboardTrafficSeries",
		Summary: "Get multi-granularity per-server traffic series (1h/6h/12h/1d/7d)",
		Returns: "DashboardTrafficSeries",
	})
}

func normalizeTrafficGranularity(raw string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "1h":
		return "1h", true
	case "6h":
		return "6h", true
	case "12h":
		return "12h", true
	case "1d", "24h", "daily":
		return "1d", true
	case "7d", "weekly":
		return "7d", true
	default:
		return "", false
	}
}

func adminGetDashboardTrafficSeries(ctx context.Context, req *rpc.JsonRpcRequest) (any, *rpc.JsonRpcError) {
	rawGranularity, _ := rpc.GetParamAs[string](req, "granularity")
	granularity, ok := normalizeTrafficGranularity(rawGranularity)
	if !ok {
		return nil, rpc.MakeError(rpc.InvalidParams, "invalid granularity (expected 1h, 6h, 12h, 1d, or 7d)", nil)
	}

	now := time.Now().UTC()
	loc := dashboardClock()
	settings := loadDashboardSettings()
	ttl := time.Duration(settings.ChartRefreshSeconds) * time.Second
	cacheKey := loc.String() + "|" + granularity

	value, err := dashboardTrafficSeriesCache.get(ctx, now, cacheKey, ttl, func() (dashboardTrafficSeriesResponse, error) {
		return loadDashboardTrafficSeries(ctx, granularity, now, loc)
	})
	if err != nil {
		return nil, rpc.MakeError(rpc.InternalError, err.Error(), nil)
	}
	return value, nil
}

func loadDashboardTrafficSeries(
	ctx context.Context,
	granularity string,
	now time.Time,
	loc *time.Location,
) (dashboardTrafficSeriesResponse, error) {
	if loc == nil {
		loc = timeutil.BeijingLocation
	}
	clientList, err := clients.GetAllClientBasicInfo()
	if err != nil {
		return dashboardTrafficSeriesResponse{}, fmt.Errorf("list dashboard clients: %w", err)
	}
	if len(clientList) == 0 {
		return dashboardTrafficSeriesResponse{
			Granularity: granularity,
			Servers:     []dashboardTrafficServerMeta{},
			Buckets:     []dashboardTrafficSeriesBucket{},
			GeneratedAt: now,
		}, nil
	}

	switch granularity {
	case "1h", "6h", "12h":
		return loadSubDayDashboardTrafficSeries(ctx, clientList, granularity, now, loc)
	case "1d":
		return loadLedgerDashboardTrafficSeries(ctx, clientList, granularity, trafficledger.DashboardHistoryDays, 1, now, loc)
	case "7d":
		return loadLedgerDashboardTrafficSeries(ctx, clientList, granularity, trafficledger.MonthlyLedgerRetentionDays, 7, now, loc)
	default:
		return dashboardTrafficSeriesResponse{}, fmt.Errorf("unsupported granularity: %s", granularity)
	}
}

func subDayWindowHours(ctx context.Context, granularity string) (int, int) {
	retentionDays := 2
	if summary, err := metricstore.GetRetentionSummary(ctx); err == nil && summary.MaxDays > retentionDays {
		retentionDays = summary.MaxDays
	}
	switch granularity {
	case "1h":
		return 1, 24
	case "6h":
		days := retentionDays
		if days < 2 {
			days = 2
		}
		if days > 7 {
			days = 7
		}
		return 6, days * 24
	case "12h":
		days := retentionDays
		if days < 2 {
			days = 2
		}
		if days > 14 {
			days = 14
		}
		return 12, days * 24
	default:
		return 1, 24
	}
}

func alignLocalBucketStart(t time.Time, stepHours int, loc *time.Location) time.Time {
	local := t.In(loc)
	alignedHour := (local.Hour() / stepHours) * stepHours
	return time.Date(local.Year(), local.Month(), local.Day(), alignedHour, 0, 0, 0, loc)
}

func formatSubDayBucketLabel(start time.Time, stepHours, totalHours int, loc *time.Location) string {
	local := start.In(loc)
	if totalHours <= 24 && stepHours == 1 {
		return fmt.Sprintf("%02d:00", local.Hour())
	}
	return fmt.Sprintf("%d/%d %02d:00", int(local.Month()), local.Day(), local.Hour())
}

func loadSubDayDashboardTrafficSeries(
	ctx context.Context,
	clientList []models.Client,
	granularity string,
	now time.Time,
	loc *time.Location,
) (dashboardTrafficSeriesResponse, error) {
	stepHours, totalHours := subDayWindowHours(ctx, granularity)
	step := time.Duration(stepHours) * time.Hour
	currentBucket := alignLocalBucketStart(now, stepHours, loc)
	bucketCount := totalHours / stepHours
	if bucketCount < 1 {
		bucketCount = 1
	}
	firstBucket := currentBucket.Add(-time.Duration(bucketCount-1) * step)

	clientIDs := make([]string, 0, len(clientList))
	for _, client := range clientList {
		clientIDs = append(clientIDs, client.UUID)
	}

	_, hourlyByClient, err := trafficledger.MetricUsageByHourBatch(ctx, clientIDs, firstBucket.UTC(), now.UTC())
	if err != nil {
		return dashboardTrafficSeriesResponse{}, fmt.Errorf("query %s traffic series: %w", granularity, err)
	}

	today := dashboardDay(now, loc)
	adjustments, err := trafficledger.DailyAdjustments(ctx, dbcore.GetDBInstance(), firstBucket, today.AddDate(0, 0, 1))
	if err != nil {
		return dashboardTrafficSeriesResponse{}, fmt.Errorf("read %s traffic calibration: %w", granularity, err)
	}

	buckets, servers := summarizeSubDayTrafficBuckets(
		clientList,
		hourlyByClient,
		adjustments,
		firstBucket,
		stepHours,
		bucketCount,
		totalHours,
		now,
		loc,
	)

	return dashboardTrafficSeriesResponse{
		Granularity: granularity,
		Servers:     servers,
		Buckets:     buckets,
		GeneratedAt: now,
	}, nil
}

func summarizeSubDayTrafficBuckets(
	clientList []models.Client,
	hourlyByClient map[string][]trafficledger.HourlyUsage,
	adjustments map[string]trafficledger.SignedUsage,
	firstBucket time.Time,
	stepHours, bucketCount, totalHours int,
	now time.Time,
	loc *time.Location,
) ([]dashboardTrafficSeriesBucket, []dashboardTrafficServerMeta) {
	step := time.Duration(stepHours) * time.Hour
	buckets := make([]dashboardTrafficSeriesBucket, bucketCount)
	indexByStart := make(map[int64]int, bucketCount)
	for i := 0; i < bucketCount; i++ {
		bStart := firstBucket.Add(time.Duration(i) * step)
		bEnd := bStart.Add(step)
		if bEnd.After(now) {
			bEnd = now.In(loc)
		}
		buckets[i] = dashboardTrafficSeriesBucket{
			Start: bStart.UTC(),
			End:   bEnd.UTC(),
			Label: formatSubDayBucketLabel(bStart, stepHours, totalHours, loc),
		}
		indexByStart[bStart.Unix()] = i
	}

	todayKey := dashboardDay(now, loc).Format(time.DateOnly)
	serverTotals := make(map[string]int64, len(clientList))

	for _, client := range clientList {
		adj := adjustments[client.UUID+"\x00"+todayKey]
		adjustedHours := trafficledger.ApplyHourlyAdjustmentIn(hourlyByClient[client.UUID], adj, now, loc)
		for _, h := range adjustedHours {
			if h.Up <= 0 && h.Down <= 0 {
				continue
			}
			slotStart := alignLocalBucketStart(h.Hour, stepHours, loc)
			idx, ok := indexByStart[slotStart.Unix()]
			if !ok {
				continue
			}
			b := &buckets[idx]
			if b.ByServer == nil {
				b.ByServer = make(map[string]dashboardTrafficSeriesUsage)
			}
			cur := b.ByServer[client.UUID]
			cur.Up += h.Up
			cur.Down += h.Down
			cur.Total = cur.Up + cur.Down
			b.ByServer[client.UUID] = cur
			b.Up += h.Up
			b.Down += h.Down
			b.Total = b.Up + b.Down
			serverTotals[client.UUID] += h.Up + h.Down
		}
	}

	return buckets, orderedTrafficSeriesServers(clientList, serverTotals)
}

func loadLedgerDashboardTrafficSeries(
	ctx context.Context,
	clientList []models.Client,
	granularity string,
	totalDays, groupDays int,
	now time.Time,
	loc *time.Location,
) (dashboardTrafficSeriesResponse, error) {
	today := dashboardDay(now, loc)
	start := today.AddDate(0, 0, -(totalDays - 1))
	db := dbcore.GetDBInstance()

	var rows []models.TrafficDailyLedger
	if err := db.WithContext(ctx).
		Select("client", "day", "up_bytes", "down_bytes").
		Where("day >= ? AND day < ?", start.Format(time.DateOnly), today.Format(time.DateOnly)).
		Find(&rows).Error; err != nil {
		return dashboardTrafficSeriesResponse{}, fmt.Errorf("read %s traffic ledger: %w", granularity, err)
	}

	adjustments, err := trafficledger.DailyAdjustments(ctx, db, start, today.AddDate(0, 0, 1))
	if err != nil {
		return dashboardTrafficSeriesResponse{}, fmt.Errorf("read %s traffic calibration: %w", granularity, err)
	}

	clientIDs := make([]string, 0, len(clientList))
	for _, client := range clientList {
		clientIDs = append(clientIDs, client.UUID)
	}
	todayUsage, _, err := trafficledger.MetricUsageByHourBatch(ctx, clientIDs, today.UTC(), now.UTC())
	if err != nil {
		return dashboardTrafficSeriesResponse{}, fmt.Errorf("read today's traffic for %s series: %w", granularity, err)
	}

	buckets, servers := summarizeLedgerTrafficBuckets(clientList, rows, todayUsage, adjustments, totalDays, groupDays, now, loc)
	return dashboardTrafficSeriesResponse{
		Granularity: granularity,
		Servers:     servers,
		Buckets:     buckets,
		GeneratedAt: now,
	}, nil
}

func summarizeLedgerTrafficBuckets(
	clientList []models.Client,
	rows []models.TrafficDailyLedger,
	todayUsage map[string]trafficledger.Usage,
	adjustments map[string]trafficledger.SignedUsage,
	totalDays, groupDays int,
	now time.Time,
	loc *time.Location,
) ([]dashboardTrafficSeriesBucket, []dashboardTrafficServerMeta) {
	if loc == nil {
		loc = timeutil.BeijingLocation
	}
	if groupDays < 1 {
		groupDays = 1
	}
	today := dashboardDay(now, loc)
	start := today.AddDate(0, 0, -(totalDays - 1))

	clientsByID := make(map[string]models.Client, len(clientList))
	for _, client := range clientList {
		clientsByID[client.UUID] = client
	}

	bucketCount := (totalDays + groupDays - 1) / groupDays
	buckets := make([]dashboardTrafficSeriesBucket, bucketCount)
	dayToBucket := make(map[string]int, totalDays)

	for offset := 0; offset < totalDays; offset++ {
		day := start.AddDate(0, 0, offset)
		bIdx := offset / groupDays
		dayToBucket[day.Format(time.DateOnly)] = bIdx
		if buckets[bIdx].Start.IsZero() {
			buckets[bIdx].Start = day.UTC()
		}
		endDay := day.AddDate(0, 0, 1)
		if day.Equal(today) {
			endDay = now
		}
		buckets[bIdx].End = endDay.UTC()
		if groupDays == 1 {
			buckets[bIdx].Label = day.Format(time.DateOnly)
		} else {
			firstLocal := buckets[bIdx].Start.In(loc)
			buckets[bIdx].Label = fmt.Sprintf("%d/%d~%d/%d", int(firstLocal.Month()), firstLocal.Day(), int(day.Month()), day.Day())
		}
	}

	serverTotals := make(map[string]int64, len(clientList))
	addUsage := func(bIdx int, uuid string, usage trafficledger.Usage) {
		if usage.Up <= 0 && usage.Down <= 0 {
			return
		}
		b := &buckets[bIdx]
		if b.ByServer == nil {
			b.ByServer = make(map[string]dashboardTrafficSeriesUsage)
		}
		cur := b.ByServer[uuid]
		cur.Up += usage.Up
		cur.Down += usage.Down
		cur.Total = cur.Up + cur.Down
		b.ByServer[uuid] = cur
		b.Up += usage.Up
		b.Down += usage.Down
		b.Total = b.Up + b.Down
		serverTotals[uuid] += usage.Up + usage.Down
	}

	for _, row := range rows {
		if _, ok := clientsByID[row.Client]; !ok {
			continue
		}
		bIdx, ok := dayToBucket[row.Day]
		if !ok {
			continue
		}
		usage := trafficledger.ApplyAdjustment(
			trafficledger.Usage{Up: row.UpBytes, Down: row.DownBytes},
			adjustments[row.Client+"\x00"+row.Day],
		)
		addUsage(bIdx, row.Client, usage)
	}

	todayKey := today.Format(time.DateOnly)
	if todayIdx, ok := dayToBucket[todayKey]; ok {
		for _, client := range clientList {
			usage := trafficledger.ApplyAdjustment(todayUsage[client.UUID], adjustments[client.UUID+"\x00"+todayKey])
			addUsage(todayIdx, client.UUID, usage)
		}
	}

	return buckets, orderedTrafficSeriesServers(clientList, serverTotals)
}

func orderedTrafficSeriesServers(
	clientList []models.Client,
	serverTotals map[string]int64,
) []dashboardTrafficServerMeta {
	servers := make([]dashboardTrafficServerMeta, 0, len(clientList))
	for _, client := range clientList {
		servers = append(servers, dashboardTrafficServerMeta{
			UUID: client.UUID,
			Name: dashboardNodeName(client),
		})
	}
	sort.SliceStable(servers, func(i, j int) bool {
		left, right := serverTotals[servers[i].UUID], serverTotals[servers[j].UUID]
		if left != right {
			return left > right
		}
		return servers[i].Name < servers[j].Name
	})
	return servers
}
