package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"

	"github.com/disintegration/imaging"
	"image/png"
)

type input struct {
	ServerConnection serverConnection       `json:"server_connection"`
	Args             map[string]interface{} `json:"args"`
}

type output struct {
	Error  *string     `json:"error"`
	Output interface{} `json:"output"`
}

type serverConnection struct {
	Scheme        string       `json:"Scheme"`
	Host          string       `json:"Host"`
	Port          int          `json:"Port"`
	SessionCookie *http.Cookie `json:"SessionCookie"`
}

type graphQLClient struct {
	endpoint string
	http     *http.Client
	cookie   *http.Cookie
}

type groupResponse struct {
	FindGroup struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		SubGroups []struct {
			Group struct {
				ID             string `json:"id"`
				FrontImagePath string `json:"front_image_path"`
			} `json:"group"`
		} `json:"sub_groups"`
		FrontImagePath string `json:"front_image_path"`
	} `json:"findGroup"`
}

type graphQLError struct {
	Message string `json:"message"`
}

type graphQLResponse struct {
	Data   json.RawMessage `json:"data"`
	Errors []graphQLError  `json:"errors"`
}

func main() {
	var in input
	raw, err := io.ReadAll(os.Stdin)
	if err == nil {
		err = json.Unmarshal(raw, &in)
	}

	out := output{}
	if err == nil {
		err = run(in, &out)
	}
	if err != nil {
		message := err.Error()
		out.Error = &message
	}

	encoded, marshalErr := json.Marshal(out)
	if marshalErr != nil {
		fmt.Fprintln(os.Stderr, marshalErr)
		os.Exit(1)
	}
	fmt.Println(string(encoded))
}

func run(in input, out *output) error {
	groupID := stringArg(in.Args, "group_id")
	if groupID == "" {
		groupID = stringArg(in.Args, "id")
	}
	if groupID == "" {
		return errors.New("missing required argument: group_id")
	}

	client, err := newClient(in.ServerConnection)
	if err != nil {
		return err
	}

	parent, err := client.findGroup(groupID)
	if err != nil {
		return err
	}
	if len(parent.FindGroup.SubGroups) == 0 {
		return fmt.Errorf("group %s has no child groups", groupID)
	}

	images := make([]image.Image, 0, len(parent.FindGroup.SubGroups))
	imageCount := intArg(in.Args, "image_count", 0)
	if imageCount < 0 {
		return errors.New("image_count must not be negative")
	}
	for _, child := range parent.FindGroup.SubGroups {
		if imageCount > 0 && len(images) >= imageCount {
			break
		}
		if child.Group.FrontImagePath == "" {
			continue
		}

		img, err := client.fetchImage(child.Group.FrontImagePath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "group-cover: skipping child %s image: %v\n", child.Group.ID, err)
			continue
		}
		images = append(images, img)
	}

	if len(images) == 0 {
		return errors.New("none of the child groups have usable front images")
	}
	if stringArg(in.Args, "mode") == "preview" {
		in.Args["preview"] = true
	}

	if stringArg(in.Args, "mode") == "preview_all" {
		previews := make(map[string]string)
		for _, design := range []string{"grid", "filmstrip", "stack", "vertical_strip", "diagonal", "hero"} {
			previewArgs := make(map[string]interface{}, len(in.Args)+1)
			for key, value := range in.Args {
				previewArgs[key] = value
			}
			previewArgs["design"] = design
			previewArgs["preview"] = true
			preview, err := compose(images, previewArgs)
			if err != nil {
				return err
			}
			dataURL, err := pngDataURL(preview)
			if err != nil {
				return err
			}
			previews[design] = dataURL
		}
		out.Output = map[string]interface{}{"previews": previews, "images_used": len(images)}
		return nil
	}
	composed, err := compose(images, in.Args)
	if err != nil {
		return err
	}

	dataURL, err := pngDataURL(composed)
	if err != nil {
		return err
	}
	if stringArg(in.Args, "mode") == "preview" {
		out.Output = map[string]interface{}{
			"data_url":    dataURL,
			"images_used": len(images),
			"width":       composed.Bounds().Dx(),
			"height":      composed.Bounds().Dy(),
		}
		return nil
	}
	if err := client.updateGroupFrontImage(groupID, dataURL); err != nil {
		return err
	}

	out.Output = map[string]interface{}{
		"group_id":    groupID,
		"images_used": len(images),
		"width":       composed.Bounds().Dx(),
		"height":      composed.Bounds().Dy(),
	}
	return nil
}

func pngDataURL(source image.Image) (string, error) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		return "", fmt.Errorf("encode generated image: %w", err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes()), nil
}

func newClient(connection serverConnection) (*graphQLClient, error) {
	scheme := connection.Scheme
	if scheme == "" {
		scheme = "http"
	}
	host := connection.Host
	if host == "" {
		host = "localhost"
	}
	if connection.Port == 0 {
		connection.Port = 9999
	}

	endpoint := fmt.Sprintf("%s://%s:%d/graphql", scheme, host, connection.Port)
	return &graphQLClient{
		endpoint: endpoint,
		http:     &http.Client{},
		cookie:   connection.SessionCookie,
	}, nil
}

func (c *graphQLClient) query(query string, variables map[string]interface{}, target interface{}) error {
	payload, err := json.Marshal(map[string]interface{}{
		"query":     query,
		"variables": variables,
	})
	if err != nil {
		return err
	}

	request, err := http.NewRequest(http.MethodPost, c.endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	if c.cookie != nil {
		request.AddCookie(c.cookie)
	}

	response, err := c.http.Do(request)
	if err != nil {
		return fmt.Errorf("GraphQL request failed: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("GraphQL request returned %s: %s", response.Status, strings.TrimSpace(string(body)))
	}

	var envelope graphQLResponse
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return fmt.Errorf("decode GraphQL response: %w", err)
	}
	if len(envelope.Errors) > 0 {
		messages := make([]string, 0, len(envelope.Errors))
		for _, graphQLError := range envelope.Errors {
			messages = append(messages, graphQLError.Message)
		}
		return fmt.Errorf("GraphQL error: %s", strings.Join(messages, "; "))
	}
	return json.Unmarshal(envelope.Data, target)
}

func (c *graphQLClient) findGroup(id string) (groupResponse, error) {
	const query = `query FindGroup($id: ID!) {
        findGroup(id: $id) {
            id
            name
            front_image_path
		 sub_groups { group { id front_image_path } }
        }
    }`
	var response groupResponse
	err := c.query(query, map[string]interface{}{"id": id}, &response)
	return response, err
}

func (c *graphQLClient) updateGroupFrontImage(id, dataURL string) error {
	const mutation = `mutation UpdateGroup($input: GroupUpdateInput!) {
        groupUpdate(input: $input) { id }
    }`
	var response struct {
		GroupUpdate struct {
			ID string `json:"id"`
		} `json:"groupUpdate"`
	}
	return c.query(mutation, map[string]interface{}{
		"input": map[string]interface{}{
			"id":          id,
			"front_image": dataURL,
		},
	}, &response)
}

func (c *graphQLClient) fetchImage(rawURL string) (image.Image, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if !parsed.IsAbs() {
		base, err := url.Parse(c.endpoint)
		if err != nil {
			return nil, err
		}
		base.Path = path.Join(path.Dir(base.Path), parsed.Path)
		base.RawQuery = parsed.RawQuery
		parsed = base
	}

	request, err := http.NewRequest(http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	if c.cookie != nil {
		request.AddCookie(c.cookie)
	}
	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("image request returned %s", response.Status)
	}
	decoded, _, err := image.Decode(response.Body)
	if err != nil {
		return nil, fmt.Errorf("decode image: %w", err)
	}
	return decoded, nil
}

func compose(images []image.Image, args map[string]interface{}) (image.Image, error) {
	fullWidth, fullHeight := canvasSize(stringArg(args, "aspect"))
	width, height := fullWidth, fullHeight
	previewScale := 1.0
	if boolArg(args, "preview", false) {
		width, height = previewCanvasSize(stringArg(args, "aspect"))
		previewScale = float64(width) / float64(fullWidth)
	}
	between := intArg(args, "gutter", 10)
	border := intArg(args, "border", between)
	if previewScale != 1 {
		between = int(math.Round(float64(between) * previewScale))
		border = int(math.Round(float64(border) * previewScale))
	}
	if between < 0 || border < 0 {
		return nil, errors.New("gutter and border must not be negative")
	}
	background := parseColor(stringArg(args, "gutter_color"))
	corner := stringArg(args, "corner")
	if corner == "" {
		corner = "square"
	}
	design := stringArg(args, "design")
	if design == "" {
		design = "grid"
	}

	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: background}, image.Point{}, draw.Src)
	content := image.Rect(border, border, width-border, height-border)
	if content.Dx() <= 0 || content.Dy() <= 0 {
		return nil, errors.New("border is too large for the selected aspect ratio")
	}

	switch design {
	case "grid":
		radius := intArg(args, "corner_radius", 12)
		drawGrid(canvas, images, content, between, corner, radius, stringArg(args, "grid_layout"))
	case "hero":
		radius := intArg(args, "corner_radius", 12)
		drawHero(canvas, images, content, between, corner, radius, intArg(args, "hero_index", 0), stringArg(args, "hero_layout"))
	case "filmstrip":
		radius := intArg(args, "corner_radius", 12)
		drawFilmstrip(canvas, images, content, between, corner, radius)
	case "stack":
		radius := intArg(args, "corner_radius", 12)
		angle := floatArg(args, "angle", 22)
		spacing := floatArg(args, "fan_spacing", fanDefaultSpacing(len(images)))
		drawStack(canvas, images, content, corner, radius, angle, spacing, floatArg(args, "fan_distance", 6), boolArg(args, "fan_reverse", false))
	case "vertical_strip":
		radius := intArg(args, "corner_radius", 12)
		drawVerticalStrip(canvas, images, content, between, corner, radius)
	case "diagonal":
		radius := intArg(args, "corner_radius", 12)
		angle := floatArg(args, "angle", 45)
		drawDiagonal(canvas, images, content, between, corner, radius, angle, boolArg(args, "reverse", false))
	default:
		return nil, fmt.Errorf("unknown layout design %q", design)
	}
	return canvas, nil
}

func previewCanvasSize(aspect string) (int, int) {
	width, height := canvasSize(aspect)
	scale := 400.0 / float64(maxInt(width, height))
	return maxInt(1, int(float64(width)*scale)), maxInt(1, int(float64(height)*scale))
}

func canvasSize(aspect string) (int, int) {
	switch aspect {
	case "1:1":
		return 800, 800
	case "4:3":
		return 800, 600
	case "9:16":
		return 450, 800
	case "16:9":
		return 800, 450
	default:
		return 600, 800
	}
}

func drawGrid(canvas draw.Image, images []image.Image, area image.Rectangle, gutter int, corner string, radius int, layout string) {
	if len(images) == 0 {
		return
	}
	if cells := diagonalGridCells(area, gutter, layout, len(images)); cells != nil {
		for index, source := range images {
			drawMaskedCell(canvas, source, cells[index], corner, radius)
		}
		return
	}
	columns := gridColumns(layout, len(images))
	rows := (len(images) + columns - 1) / columns
	cellHeight := (area.Dy() - (rows-1)*gutter) / rows
	for index, source := range images {
		row := index / columns
		rowStart := row * columns
		rowCount := minInt(columns, len(images)-rowStart)
		cellWidth := (area.Dx() - (rowCount-1)*gutter) / rowCount
		column := index - rowStart
		x := area.Min.X + column*(cellWidth+gutter)
		y := area.Min.Y + row*(cellHeight+gutter)
		drawMaskedCell(canvas, source, image.Rect(x, y, x+cellWidth, y+cellHeight), corner, radius)
	}
}

type diagonalGridSpec struct {
	direction     string
	compact       bool
	featuredCount int
	columns       int
	rows          int
}

func diagonalGridSpecFor(layout string, count int) (diagonalGridSpec, bool) {
	if count < 4 || !strings.HasPrefix(layout, "grid-diagonal-") {
		return diagonalGridSpec{}, false
	}
	parts := strings.Split(strings.TrimPrefix(layout, "grid-diagonal-"), "-")
	if len(parts) < 2 || len(parts) > 3 || (parts[0] != "main" && parts[0] != "reverse") {
		return diagonalGridSpec{}, false
	}
	compact := false
	countPart := parts[1]
	if len(parts) == 3 {
		if parts[1] != "compact" {
			return diagonalGridSpec{}, false
		}
		compact = true
		countPart = parts[2]
	}
	featuredCount, err := strconv.Atoi(countPart)
	if err != nil || featuredCount < 1 || featuredCount > 3 {
		return diagonalGridSpec{}, false
	}
	columns, rows := gridArrangementDimensions(count)
	return diagonalGridSpec{
		direction:     parts[0],
		compact:       compact,
		featuredCount: minInt(featuredCount, minInt(columns, rows)),
		columns:       columns,
		rows:          rows,
	}, true
}

func gridArrangementDimensions(count int) (int, int) {
	if count <= 1 {
		return 1, 1
	}
	limit := minInt(count, 4)
	bestColumns, bestRows := 1, count
	bestDifference := absInt(bestColumns - bestRows)
	completeColumns, completeRows := 0, 0
	completeDifference := math.MaxInt
	for columns := 2; columns <= limit; columns++ {
		rows := (count + columns - 1) / columns
		difference := absInt(columns - rows)
		if difference < bestDifference {
			bestColumns, bestRows, bestDifference = columns, rows, difference
		}
		if count%columns == 0 && difference < completeDifference {
			completeColumns, completeRows, completeDifference = columns, rows, difference
		}
	}
	if completeColumns > 0 {
		return completeColumns, completeRows
	}
	return bestColumns, bestRows
}

type gridCellSlot struct {
	rect     image.Rectangle
	featured bool
}

func tileGridCells(area image.Rectangle, gutter, count, columns int) []gridCellSlot {
	if count <= 0 || area.Dx() <= 0 || area.Dy() <= 0 {
		return nil
	}
	columns = maxInt(1, columns)
	rows := (count + columns - 1) / columns
	totalHeight := area.Dy() - (rows-1)*gutter
	cells := make([]gridCellSlot, 0, count)
	y := area.Min.Y
	for row := 0; row < rows; row++ {
		rowCount := minInt(columns, count-row*columns)
		cellHeight := totalHeight / rows
		if row == rows-1 {
			cellHeight = area.Max.Y - y
		}
		totalWidth := area.Dx() - (rowCount-1)*gutter
		x := area.Min.X
		for column := 0; column < rowCount; column++ {
			cellWidth := totalWidth / rowCount
			if column == rowCount-1 {
				cellWidth = area.Max.X - x
			}
			cells = append(cells, gridCellSlot{rect: image.Rect(x, y, x+cellWidth, y+cellHeight)})
			x += cellWidth + gutter
		}
		y += cellHeight + gutter
	}
	return cells
}

func diagonalGridCells(area image.Rectangle, gutter int, layout string, count int) []image.Rectangle {
	spec, ok := diagonalGridSpecFor(layout, count)
	if !ok {
		return nil
	}
	rows := 2
	if spec.featuredCount == 3 {
		rows = 3
	}
	rowCounts := make([]int, rows)
	for row := range rowCounts {
		rowCounts[row] = count / rows
		if row < count%rows {
			rowCounts[row]++
		}
	}
	featureWidthRatio := 0.54
	if spec.compact {
		featureWidthRatio = 0.42
	}
	featureWidth := minInt(area.Dx()-2*gutter, int(float64(area.Dx())*featureWidthRatio))
	bandHeight := (area.Dy() - (rows-1)*gutter) / rows
	slots := make([]gridCellSlot, 0, count)
	for row := 0; row < rows; row++ {
		hasFeature := row < spec.featuredCount
		nonFeaturedCount := rowCounts[row]
		if hasFeature {
			nonFeaturedCount--
		}
		bandY := area.Min.Y + row*(bandHeight+gutter)
		if !hasFeature {
			columns := minInt(4, maxInt(1, int(math.Ceil(math.Sqrt(float64(rowCounts[row]))))))
			slots = append(slots, tileGridCells(image.Rect(area.Min.X, bandY, area.Max.X, bandY+bandHeight), gutter, rowCounts[row], columns)...)
			continue
		}
		featureSide := row
		if spec.direction == "reverse" {
			featureSide = rows - 1 - row
		}
		centerFeature := spec.featuredCount == 3 && row == 1
		if centerFeature {
			remainingWidth := area.Dx() - featureWidth - 2*gutter
			sideWidth := remainingWidth / 2
			leftCount := (nonFeaturedCount + 1) / 2
			rightCount := nonFeaturedCount - leftCount
			bandArea := image.Rect(area.Min.X, bandY, area.Max.X, bandY+bandHeight)
			slots = append(slots, tileGridCells(image.Rect(bandArea.Min.X, bandArea.Min.Y, bandArea.Min.X+sideWidth, bandArea.Max.Y), gutter, leftCount, minInt(2, maxInt(1, leftCount)))...)
			slots = append(slots, gridCellSlot{rect: image.Rect(bandArea.Min.X+sideWidth+gutter, bandArea.Min.Y, bandArea.Min.X+sideWidth+gutter+featureWidth, bandArea.Max.Y), featured: true})
			slots = append(slots, tileGridCells(image.Rect(bandArea.Min.X+sideWidth+featureWidth+2*gutter, bandArea.Min.Y, bandArea.Max.X, bandArea.Max.Y), gutter, rightCount, minInt(2, maxInt(1, rightCount)))...)
			continue
		}
		featureOnLeft := featureSide == 0
		featureX := area.Min.X
		remainingX := area.Min.X + featureWidth + gutter
		if !featureOnLeft {
			featureX = area.Max.X - featureWidth
			remainingX = area.Min.X
		}
		bandArea := image.Rect(area.Min.X, bandY, area.Max.X, bandY+bandHeight)
		slots = append(slots, gridCellSlot{rect: image.Rect(featureX, bandArea.Min.Y, featureX+featureWidth, bandArea.Max.Y), featured: true})
		slots = append(slots, tileGridCells(image.Rect(remainingX, bandArea.Min.Y, remainingX+area.Dx()-featureWidth-gutter, bandArea.Max.Y), gutter, nonFeaturedCount, minInt(2, maxInt(1, nonFeaturedCount)))...)
	}

	cells := make([]image.Rectangle, count)
	featureIndex := 0
	regularIndex := spec.featuredCount
	for _, slot := range slots {
		if slot.featured {
			cells[featureIndex] = slot.rect
			featureIndex++
		}
	}
	for _, slot := range slots {
		if !slot.featured {
			cells[regularIndex] = slot.rect
			regularIndex++
		}
	}
	return cells
}

func drawHero(canvas draw.Image, images []image.Image, area image.Rectangle, gutter int, corner string, radius, heroIndex int, layout string) {
	if len(images) == 0 {
		return
	}
	heroIndex = clampInt(heroIndex, 0, len(images)-1)
	if layout == "hero-top" || layout == "hero-bottom" {
		drawHeroVertical(canvas, images, area, gutter, corner, radius, heroIndex, layout == "hero-bottom")
		return
	}
	if layout == "hero-center" {
		remaining := withoutImage(images, heroIndex)
		drawGrid(canvas, remaining, area, gutter, corner, radius, "")
		heroWidth := int(float64(area.Dx()) * 0.58)
		heroHeight := int(float64(area.Dy()) * 0.58)
		x := area.Min.X + (area.Dx()-heroWidth)/2
		y := area.Min.Y + (area.Dy()-heroHeight)/2
		drawMaskedCell(canvas, images[heroIndex], image.Rect(x, y, x+heroWidth, y+heroHeight), corner, radius)
		return
	}
	drawMosaic(canvas, images, area, gutter, corner, radius, heroIndex, layout == "hero-right")
}

func drawHeroVertical(canvas draw.Image, images []image.Image, area image.Rectangle, gutter int, corner string, radius, heroIndex int, heroBottom bool) {
	remaining := withoutImage(images, heroIndex)
	heroHeight := int(float64(area.Dy()-gutter) * 0.58)
	remainingHeight := area.Dy() - gutter - heroHeight
	heroY := area.Min.Y
	remainingY := area.Min.Y + heroHeight + gutter
	if heroBottom {
		heroY = area.Min.Y + remainingHeight + gutter
		remainingY = area.Min.Y
	}
	drawMaskedCell(canvas, images[heroIndex], image.Rect(area.Min.X, heroY, area.Max.X, heroY+heroHeight), corner, radius)
	drawGridRemainder(canvas, remaining, image.Rect(area.Min.X, remainingY, area.Max.X, remainingY+remainingHeight), gutter, corner, radius)
}

func withoutImage(images []image.Image, index int) []image.Image {
	remaining := make([]image.Image, 0, len(images)-1)
	for imageIndex, source := range images {
		if imageIndex != index {
			remaining = append(remaining, source)
		}
	}
	return remaining
}

func gridColumns(layout string, count int) int {
	if count <= 1 {
		return 1
	}
	if strings.HasPrefix(layout, "grid-") {
		parts := strings.Split(strings.TrimPrefix(layout, "grid-"), "x")
		if len(parts) == 2 {
			if columns, err := strconv.Atoi(parts[0]); err == nil && columns > 0 {
				return minInt(columns, count)
			}
		}
	}
	return minInt(maxInt(2, int(math.Ceil(math.Sqrt(float64(count))))), count)
}

func drawMosaic(canvas draw.Image, images []image.Image, area image.Rectangle, gutter int, corner string, radius, heroIndex int, largeRight bool) {
	if len(images) == 0 {
		return
	}
	heroIndex = clampInt(heroIndex, 0, len(images)-1)
	largeWidth := int(float64(area.Dx()-gutter) * 0.58)
	smallWidth := area.Dx() - gutter - largeWidth
	largeX := area.Min.X
	remainingX := area.Min.X + largeWidth + gutter
	if largeRight {
		largeX = area.Min.X + smallWidth + gutter
		remainingX = area.Min.X
	}
	drawMaskedCell(canvas, images[heroIndex], image.Rect(largeX, area.Min.Y, largeX+largeWidth, area.Max.Y), corner, radius)
	remaining := make([]image.Image, 0, len(images)-1)
	for index, source := range images {
		if index != heroIndex {
			remaining = append(remaining, source)
		}
	}
	drawGridRemainder(canvas, remaining, image.Rect(remainingX, area.Min.Y, remainingX+smallWidth, area.Max.Y), gutter, corner, radius)
}

func drawGridRemainder(canvas draw.Image, images []image.Image, area image.Rectangle, gutter int, corner string, radius int) {
	if len(images) == 0 {
		return
	}
	rows := (len(images) + 1) / 2
	cellWidth := (area.Dx() - gutter) / 2
	cellHeight := (area.Dy() - (rows-1)*gutter) / rows
	for index, source := range images {
		column := index / rows
		row := index % rows
		x := area.Min.X + column*(cellWidth+gutter)
		y := area.Min.Y + row*(cellHeight+gutter)
		width := cellWidth
		if index == len(images)-1 && len(images)%2 == 1 {
			width = cellWidth*2 + gutter
		}
		drawMaskedCell(canvas, source, image.Rect(x, y, x+width, y+cellHeight), corner, radius)
	}
}

func drawFilmstrip(canvas draw.Image, images []image.Image, area image.Rectangle, gutter int, corner string, radius int) {
	if len(images) == 0 {
		return
	}
	cellWidth := (area.Dx() - (len(images)-1)*gutter) / len(images)
	for index, source := range images {
		x := area.Min.X + index*(cellWidth+gutter)
		drawMaskedCell(canvas, source, image.Rect(x, area.Min.Y, x+cellWidth, area.Max.Y), corner, radius)
	}
}

func drawVerticalStrip(canvas draw.Image, images []image.Image, area image.Rectangle, gutter int, corner string, radius int) {
	if len(images) == 0 {
		return
	}
	cellHeight := (area.Dy() - (len(images)-1)*gutter) / len(images)
	for index, source := range images {
		y := area.Min.Y + index*(cellHeight+gutter)
		drawMaskedCell(canvas, source, image.Rect(area.Min.X, y, area.Max.X, y+cellHeight), corner, radius)
	}
}

func drawStack(canvas draw.Image, images []image.Image, area image.Rectangle, corner string, radius int, angle, spacing, distance float64, reverse bool) {
	count := len(images)
	if count == 0 {
		return
	}
	cardWidth := minInt(int(float64(area.Dx())*0.72), int(float64(area.Dy())*0.72*0.75))
	cardHeight := int(float64(cardWidth) / 0.75)
	card := image.Rect(0, 0, cardWidth, cardHeight)
	spread := float64(area.Dx()) * spacing / 100 * float64(maxInt(count-1, 1))
	centerX := float64(area.Min.X + area.Dx()/2)
	centerY := float64(area.Min.Y + area.Dy()/2)
	for index := count - 1; index >= 0; index-- {
		position := float64(index) / float64(maxInt(count-1, 1))
		x := centerX + (position-0.5)*spread
		y := centerY + (position-0.5)*float64(area.Dy())*distance/100
		cardAngle := (position - 0.5) * angle
		if reverse {
			cardAngle = -cardAngle
		}
		drawRotatedCell(canvas, images[index], card, x, y, cardAngle, corner, radius)
	}
}

func fanDefaultSpacing(count int) float64 {
	if count <= 1 {
		return 0
	}
	total := math.Min(0.68, 0.18+0.045*float64(count))
	if count == 2 {
		total = 0.22
	}
	return total * 100 / float64(count-1)
}

func drawDiagonal(canvas draw.Image, images []image.Image, area image.Rectangle, gutter int, corner string, radius int, angle float64, reverse bool) {
	if len(images) == 0 {
		return
	}
	prepared := make([]*image.RGBA, 0, len(images))
	for _, source := range images {
		cell := image.NewRGBA(image.Rect(0, 0, area.Dx(), area.Dy()))
		drawCover(cell, source, cell.Bounds())
		prepared = append(prepared, cell)
	}
	baseAngle := math.Atan2(float64(area.Dy()), float64(area.Dx())) * 180 / math.Pi
	effectiveAngle := angle
	if reverse {
		effectiveAngle = 2*baseAngle - angle
	}
	delta := (effectiveAngle - baseAngle) * math.Pi / 180
	boundaryGap := float64(gutter) * diagonalScoreGradient(area.Dx(), area.Dy(), angle, reverse)
	for y := 0; y < area.Dy(); y++ {
		for x := 0; x < area.Dx(); x++ {
			u := float64(x) / float64(maxInt(area.Dx()-1, 1))
			v := float64(y) / float64(maxInt(area.Dy()-1, 1))
			// Rotate normalized coordinates around the corner-to-corner baseline.
			// At 45 degrees, regular cuts run TL-to-BR and reverse cuts TR-to-BL.
			cx, cy := u-0.5, v-0.5
			u = cx*math.Cos(delta) - cy*math.Sin(delta) + 0.5
			v = cx*math.Sin(delta) + cy*math.Cos(delta) + 0.5
			score := (u + v) / 2
			if reverse {
				score = (u - v + 1) / 2
			}
			gap := false
			for boundary := 1; boundary < len(prepared); boundary++ {
				if math.Abs(score-float64(boundary)/float64(len(prepared))) < boundaryGap/2 {
					gap = true
					break
				}
			}
			if gap {
				continue
			}
			index := int(score * float64(len(prepared)))
			if index >= len(prepared) {
				index = len(prepared) - 1
			}
			if insideCorner(x, y, area.Dx(), area.Dy(), corner, radiusFor(area.Dx(), area.Dy(), radius)) {
				canvas.Set(area.Min.X+x, area.Min.Y+y, prepared[index].At(x, y))
			}
		}
	}
}

func diagonalScoreGradient(width, height int, angle float64, reverse bool) float64 {
	baseAngle := math.Atan2(float64(height), float64(width)) * 180 / math.Pi
	if reverse {
		angle = 2*baseAngle - angle
	}
	delta := (angle - baseAngle) * math.Pi / 180
	var du, dv float64
	if reverse {
		du = (math.Cos(delta) - math.Sin(delta)) / 2
		dv = (-math.Sin(delta) - math.Cos(delta)) / 2
	} else {
		du = (math.Cos(delta) + math.Sin(delta)) / 2
		dv = (-math.Sin(delta) + math.Cos(delta)) / 2
	}
	return math.Sqrt((du/float64(maxInt(width, 1)))*(du/float64(maxInt(width, 1))) + (dv/float64(maxInt(height, 1)))*(dv/float64(maxInt(height, 1))))
}

func drawMaskedCell(destination draw.Image, source image.Image, target image.Rectangle, corner string, radius int) {
	if target.Dx() <= 0 || target.Dy() <= 0 {
		return
	}
	cell := image.NewRGBA(image.Rect(0, 0, target.Dx(), target.Dy()))
	drawCover(cell, source, cell.Bounds())
	cellRadius := radiusFor(target.Dx(), target.Dy(), radius)
	for y := 0; y < target.Dy(); y++ {
		for x := 0; x < target.Dx(); x++ {
			if insideCorner(x, y, target.Dx(), target.Dy(), corner, cellRadius) {
				destination.Set(target.Min.X+x, target.Min.Y+y, cell.At(x, y))
			}
		}
	}
}

func drawRotatedCell(destination draw.Image, source image.Image, cell image.Rectangle, centerX, centerY, angle float64, corner string, radius int) {
	prepared := imaging.Fill(source, cell.Dx(), cell.Dy(), imaging.Center, imaging.Lanczos)
	masked := image.NewRGBA(cell)
	drawMaskedCell(masked, prepared, cell, corner, radius)
	rotated := imaging.Rotate(masked, -angle, color.Transparent)
	position := image.Pt(int(math.Round(centerX-float64(rotated.Bounds().Dx())/2)), int(math.Round(centerY-float64(rotated.Bounds().Dy())/2)))
	draw.Draw(destination, rotated.Bounds().Add(position), rotated, rotated.Bounds().Min, draw.Over)
}

func radiusFor(width, height, percentage int) int {
	if percentage < 0 {
		percentage = 0
	}
	if percentage > 50 {
		percentage = 50
	}
	return minInt(width, height) * percentage / 100
}

func insideCorner(x, y, width, height int, corner string, radius int) bool {
	if corner == "square" || radius <= 0 {
		return true
	}
	if corner == "cut" {
		return !(x+y < radius || (width-1-x)+y < radius || x+(height-1-y) < radius || (width-1-x)+(height-1-y) < radius)
	}
	checks := [][3]int{{x, y, 0}, {width - 1 - x, y, 0}, {x, height - 1 - y, 0}, {width - 1 - x, height - 1 - y, 0}}
	for _, check := range checks {
		if check[0] < radius && check[1] < radius {
			dx := radius - 1 - check[0]
			dy := radius - 1 - check[1]
			if dx*dx+dy*dy > radius*radius {
				return false
			}
		}
	}
	return true
}

func parseColor(value string) color.RGBA {
	parts := strings.SplitN(strings.TrimSpace(value), ",", 2)
	value = strings.TrimPrefix(parts[0], "#")
	if len(value) != 6 {
		return color.RGBA{R: 255, G: 255, B: 255, A: 255}
	}
	red, _ := strconv.ParseUint(value[0:2], 16, 8)
	green, _ := strconv.ParseUint(value[2:4], 16, 8)
	blue, _ := strconv.ParseUint(value[4:6], 16, 8)
	alpha := 255
	if len(parts) == 2 {
		if parsedAlpha, err := strconv.Atoi(strings.TrimSpace(parts[1])); err == nil {
			alpha = int(math.Round(float64(clampInt(parsedAlpha, 0, 100)) * 2.55))
		}
	}
	return color.RGBA{R: uint8(red), G: uint8(green), B: uint8(blue), A: uint8(alpha)}
}

func clampInt(value, low, high int) int {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

func drawCover(destination draw.Image, source image.Image, target image.Rectangle) {
	resized := imaging.Fill(source, target.Dx(), target.Dy(), imaging.Center, imaging.Lanczos)
	draw.Draw(destination, target, resized, resized.Bounds().Min, draw.Src)
}

func stringArg(args map[string]interface{}, key string) string {
	value, ok := args[key]
	if !ok {
		return ""
	}
	if stringValue, ok := value.(string); ok {
		return stringValue
	}
	if numberValue, ok := value.(float64); ok {
		return strconv.FormatInt(int64(numberValue), 10)
	}
	return ""
}

func intArg(args map[string]interface{}, key string, fallback int) int {
	value := stringArg(args, key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func floatArg(args map[string]interface{}, key string, fallback float64) float64 {
	value := stringArg(args, key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func boolArg(args map[string]interface{}, key string, fallback bool) bool {
	value, ok := args[key]
	if !ok {
		return fallback
	}
	if parsed, ok := value.(bool); ok {
		return parsed
	}
	return fallback
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
