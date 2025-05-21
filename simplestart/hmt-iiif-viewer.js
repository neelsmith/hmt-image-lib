const HMTIIIFViewer = (function() {
    'use strict';

    let config = {
        protocol: 'http',
        server: 'www.homermultitext.org/iipsrv',
        iifPath: 'IIIF=', // Note: The prompt had ?IIIF=, but iipsrv typically uses /IIIF/
                         // However, HMT's specific setup seems to be iipsrv?IIIF=
                         // Let's stick to the prompt for HMT.
        basePrefixPath: '/project/homer/pyramidal/deepzoom'
    };

    let state = {
        canvas: null,
        ctx: null,
        container: null,
        urn: null,
        info: null, // To store info.json response
        iiifBaseUrl: null, // Base URL for image specific requests (up to image ID)
        
        // Image properties from info.json
        imageFullWidth: 0,
        imageFullHeight: 0,
        tileSources: [], // To store tile info (width, height, scaleFactors)

        // Viewport state
        zoom: 1.0,       // Current zoom level (1.0 = 100% of base layer)
        offsetX: 0,      // Pan X offset (in full image pixels at current zoom)
        offsetY: 0,      // Pan Y offset
        minZoom: 0.1,
        maxZoom: 10.0,   // Arbitrary max zoom

        // Dragging state
        isDragging: false,
        lastDragX: 0,
        lastDragY: 0,

        // Tile Caching
        tileCache: {},
        maxCacheSize: 200 // Max number of tiles to cache
    };

    function parseURNToIIIFBase(urn) {
        const parts = urn.split(':');
        if (parts.length < 5) {
            console.error('Invalid CITE2 URN:', urn);
            return null;
        }

        const namespace = parts[2];
        const collectionComponent = parts[3];
        const objectId = parts[4];

        const collectionParts = collectionComponent.split('.');
        if (collectionParts.length < 2) {
            console.error('Invalid collection component in URN:', collectionComponent);
            return null;
        }

        const iiifPrefix = `${config.basePrefixPath}/${namespace}/${collectionParts[0]}/${collectionParts[1]}`;
        const imageIdentifier = `${objectId}.tif`;
        
        // http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a/VA012RN_0013.tif
        return `${config.protocol}://${config.server}?${config.iifPath}${iiifPrefix}/${imageIdentifier}`;
    }

    async function fetchInfo(urn) {
        state.iiifBaseUrl = parseURNToIIIFBase(urn);
        if (!state.iiifBaseUrl) return false;

        const infoUrl = `${state.iiifBaseUrl}/info.json`;
        console.log('Fetching info.json from:', infoUrl);

        try {
            const response = await fetch(infoUrl, { mode: 'cors' });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} for ${infoUrl}`);
            }
            state.info = await response.json();
            state.imageFullWidth = state.info.width;
            state.imageFullHeight = state.info.height;
            
            // Extract tile information. Typically, there's one main tile source.
            // HMT uses "tiles": [ { "width": 1024, "scaleFactors": [1,2,4,8,16,32] } ]
            // The height is often assumed to be the same as width for square tiles, or explicitly provided.
            // If not provided, we can assume square tiles or calculate if total image dimensions are not multiple of tile width.
            if (state.info.tiles && state.info.tiles.length > 0) {
                state.tileSources = state.info.tiles.map(tileInfo => ({
                    width: tileInfo.width,
                    height: tileInfo.height || tileInfo.width, // Assume square if height not given
                    scaleFactors: tileInfo.scaleFactors.sort((a, b) => a - b) // Ensure sorted
                }));
            } else {
                // Fallback if no explicit tiles definition (less common for IIIF level 2)
                // We might default to a single tile being the whole image, or a fixed tile size like 256x256
                // For this HMT viewer, we expect the 'tiles' structure.
                console.warn('No detailed tile information found in info.json. Viewer might not perform optimally.');
                state.tileSources = [{
                    width: state.imageFullWidth, // Treat as one big tile
                    height: state.imageFullHeight,
                    scaleFactors: [1]
                }];
            }

            // Set initial zoom to fit image width in container
            const containerWidth = state.container.clientWidth;
            if (state.imageFullWidth > 0) {
                state.zoom = containerWidth / state.imageFullWidth;
                state.minZoom = state.zoom / 4; // Allow zooming out 4x from initial fit
                state.maxZoom = Math.max(2, state.zoom * 16); // Allow zooming in 16x, or at least 2x actual size
            }
            // Center the image initially
            state.offsetX = (state.imageFullWidth / 2) - (containerWidth / (2 * state.zoom));
            state.offsetY = (state.imageFullHeight / 2) - (state.container.clientHeight / (2 * state.zoom));


            console.log('Image Info:', state.info);
            console.log('Initial zoom:', state.zoom, 'offsetX:', state.offsetX, 'offsetY:', state.offsetY);
            return true;
        } catch (error) {
            console.error('Failed to fetch or parse info.json:', error);
            state.container.innerHTML = `<p style="color:red;">Error loading image: ${error.message}</p>`;
            return false;
        }
    }

    function render() {
        if (!state.ctx || !state.info) return;

        const canvasWidth = state.canvas.width;
        const canvasHeight = state.canvas.height;

        state.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        
        // Determine the viewable region in full image coordinates
        // Top-left of viewport in full image coordinates
        const viewX1 = state.offsetX;
        const viewY1 = state.offsetY;
        // Bottom-right of viewport in full image coordinates
        const viewX2 = state.offsetX + canvasWidth / state.zoom;
        const viewY2 = state.offsetY + canvasHeight / state.zoom;

        // Choose the best tile level to use based on current zoom
        // We want the level where 1 pixel on screen is backed by roughly 1 pixel from the tile source.
        // The 'scaleFactor' in IIIF info.json means the image at that level is 1/scaleFactor the size of the full image.
        // So, a tile pixel at scaleFactor 's' covers 's' pixels of the full image.
        // We want zoom * s ~= 1, or s ~= 1 / zoom.
        const targetScaleFactor = 1 / state.zoom;
        
        // Use the first tile source (usually there's only one of significance)
        const tileSource = state.tileSources[0]; 
        if (!tileSource) {
            console.error("No tile source defined!");
            return;
        }

        let bestLevel = { index: -1, scaleFactor: Infinity, tileWidth: 0, tileHeight: 0 };
        for (let i = 0; i < tileSource.scaleFactors.length; i++) {
            const sf = tileSource.scaleFactors[i];
            // We want the smallest scaleFactor that is >= targetScaleFactor, 
            // or the largest if all are smaller (to avoid excessive upscaling).
            // More simply: pick the scaleFactor that results in tiles being displayed
            // as close as possible to their native resolution, preferably slightly downscaled.
            if (sf >= targetScaleFactor && sf < bestLevel.scaleFactor) {
                bestLevel.scaleFactor = sf;
                bestLevel.index = i;
            }
        }
        // If no scale factor is >= target, use the largest one available (most zoomed-out tiles)
        if (bestLevel.index === -1 && tileSource.scaleFactors.length > 0) {
            bestLevel.index = tileSource.scaleFactors.length - 1;
            bestLevel.scaleFactor = tileSource.scaleFactors[bestLevel.index];
        }
        
        // Dimensions of a tile AT THIS LEVEL (not scaled to screen yet)
        // The `tileSource.width` is the dimension of tiles at scaleFactor=1 (level 0).
        // For other levels, the tile still has `tileSource.width` pixels,
        // but it covers `tileSource.width * scaleFactor` pixels of the original image.
        const tileCoverageWidth = tileSource.width * bestLevel.scaleFactor;
        const tileCoverageHeight = tileSource.height * bestLevel.scaleFactor;

        // The actual size of the tile image we'll request
        const requestTileWidth = tileSource.width;
        const requestTileHeight = tileSource.height;

        // Iterate over the grid of tiles for the chosen level
        const startCol = Math.floor(Math.max(0, viewX1) / tileCoverageWidth);
        const endCol = Math.ceil(Math.min(state.imageFullWidth, viewX2) / tileCoverageWidth);
        const startRow = Math.floor(Math.max(0, viewY1) / tileCoverageHeight);
        const endRow = Math.ceil(Math.min(state.imageFullHeight, viewY2) / tileCoverageHeight);
        
        // console.log(`Zoom: ${state.zoom.toFixed(2)}, TargetSF: ${targetScaleFactor.toFixed(2)}, BestSF: ${bestLevel.scaleFactor}`);
        // console.log(`View: (${viewX1.toFixed(0)},${viewY1.toFixed(0)}) to (${viewX2.toFixed(0)},${viewY2.toFixed(0)})`);
        // console.log(`Tile grid: cols ${startCol}-${endCol-1}, rows ${startRow}-${endRow-1} at level w/ SF ${bestLevel.scaleFactor}`);

        for (let r = startRow; r < endRow; r++) {
            for (let c = startCol; c < endCol; c++) {
                const tileX = c * tileCoverageWidth; // Top-left X of this tile in full image coords
                const tileY = r * tileCoverageHeight; // Top-left Y
                
                // Actual region this tile covers in the full image
                const regionX = tileX;
                const regionY = tileY;
                const regionW = Math.min(tileCoverageWidth, state.imageFullWidth - regionX);
                const regionH = Math.min(tileCoverageHeight, state.imageFullHeight - regionY);

                // Don't request tiles for regions that are zero width/height
                if (regionW <= 0 || regionH <= 0) continue;

                // The size of the image to request. We want it at the chosen level's resolution.
                // If it's a partial tile at the edge, request only the visible part, scaled.
                // IIIF spec: region is x,y,w,h. Size is wS,hS.
                // For tiles, we request the region, and for size parameter we specify the
                // dimensions of the tile at that level e.g. '1024,' or '!1024,1024'
                // The HMT server (iipsrv) seems to prefer tile requests like:
                // /x,y,w,h/pct:percentage or /x,y,w,h/TILE_WIDTH, /default.jpg
                // For this level, the tile should be scaled by 1/bestLevel.scaleFactor from original.
                // So percentage is 100 / bestLevel.scaleFactor
                // const tileReqWidth = Math.ceil(regionW / bestLevel.scaleFactor);
                // const tileReqHeight = Math.ceil(regionH / bestLevel.scaleFactor);
                // Using fixed tile size for request, server handles scaling.
                // Request the specific tile size for that level.
                // For iipsrv, width for the size parameter seems to be the one.
                const sizeParam = `${requestTileWidth},`; // Request tile at its 'native' width for this level. Server scales if it's a partial tile.
                                                        // Or, more robustly, for a partial tile:
                                                        // const actualRequestedWidth = Math.ceil(regionW / bestLevel.scaleFactor);
                                                        // const sizeParam = `${actualRequestedWidth},`;
                // The tile URL will be: {baseIIIF}/{region_x},{region_y},{region_w},{region_h}/{size_w},/0/default.jpg
                const tileUrl = `${state.iiifBaseUrl}/${regionX},${regionY},${regionW},${regionH}/${sizeParam}/0/default.jpg`;

                // Drawing parameters on canvas:
                const drawX = (tileX - state.offsetX) * state.zoom;
                const drawY = (tileY - state.offsetY) * state.zoom;
                // The tile we get back has dimensions (approx) regionW/scaleFactor x regionH/scaleFactor
                // We need to draw it scaled by zoom.
                const drawW = (regionW / bestLevel.scaleFactor) * state.zoom * (requestTileWidth / (regionW/bestLevel.scaleFactor) );
                const drawScaledW = regionW * state.zoom;
                const drawScaledH = regionH * state.zoom;


                if (state.tileCache[tileUrl]) {
                    if (state.tileCache[tileUrl].complete && state.tileCache[tileUrl].naturalWidth > 0) {
                         // state.ctx.drawImage(state.tileCache[tileUrl], drawX, drawY, drawScaledW, drawScaledH);
                         // The tile image received is already scaled to the chosen level.
                         // Its dimensions are roughly requestTileWidth x requestTileHeight (or partial)
                         // So we draw it at drawX, drawY, and its scaled size on screen is requestTileWidth * state.zoom / bestLevel.scaleFactor
                         // No, this is simpler: tile is `tileImageWidth` x `tileImageHeight` pixels.
                         // It covers `regionW` x `regionH` of full image.
                         // So it should be drawn at `regionW * state.zoom` x `regionH * state.zoom` on canvas.
                        state.ctx.drawImage(state.tileCache[tileUrl], drawX, drawY, regionW * state.zoom, regionH * state.zoom);
                    }
                } else {
                    // Manage cache size
                    if (Object.keys(state.tileCache).length >= state.maxCacheSize) {
                        delete state.tileCache[Object.keys(state.tileCache)[0]]; // FIFO
                    }

                    const tileImage = new Image();
                    tileImage.crossOrigin = "Anonymous"; // Important for canvas tainting with CORS images
                    tileImage.src = tileUrl;
                    state.tileCache[tileUrl] = tileImage; // Add to cache (even before loaded)
                    
                    tileImage.onload = () => {
                        // Check if this tile is still relevant (user might have panned/zoomed away)
                        // A full re-render is simpler for now after any tile loads.
                        render(); 
                    };
                    tileImage.onerror = () => {
                        console.error("Error loading tile:", tileUrl);
                        // Optionally remove from cache or mark as bad
                        delete state.tileCache[tileUrl]; 
                        // state.ctx.fillStyle = 'rgba(255,0,0,0.2)';
                        // state.ctx.fillRect(drawX, drawY, regionW * state.zoom, regionH * state.zoom);
                        // state.ctx.strokeRect(drawX, drawY, regionW * state.zoom, regionH * state.zoom);
                    };
                }
                 // For debugging tile boundaries:
                // state.ctx.strokeStyle = 'rgba(0,255,0,0.5)';
                // state.ctx.strokeRect(drawX, drawY, regionW * state.zoom, regionH * state.zoom);
            }
        }
    }

    function handleZoom(event) {
        event.preventDefault();
        const zoomFactor = 1.1;
        const oldZoom = state.zoom;

        const rect = state.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left; // Mouse X relative to canvas
        const mouseY = event.clientY - rect.top;  // Mouse Y relative to canvas

        // Coordinates of mouse pointer in full image space (before zoom)
        const mouseImageX = state.offsetX + mouseX / oldZoom;
        const mouseImageY = state.offsetY + mouseY / oldZoom;

        if (event.deltaY < 0) { // Zoom in
            state.zoom = Math.min(state.maxZoom, state.zoom * zoomFactor);
        } else { // Zoom out
            state.zoom = Math.max(state.minZoom, state.zoom / zoomFactor);
        }
        
        // Adjust offsetX, offsetY so the point under the mouse remains the same
        state.offsetX = mouseImageX - mouseX / state.zoom;
        state.offsetY = mouseImageY - mouseY / state.zoom;

        // Clamp offsets to prevent panning too far out
        clampOffsets();
        requestAnimationFrame(render);
    }

    function handlePanStart(event) {
        if (event.button !== 0) return; // Only left mouse button
        state.isDragging = true;
        state.lastDragX = event.clientX;
        state.lastDragY = event.clientY;
        state.canvas.style.cursor = 'grabbing';
    }

    function handlePanMove(event) {
        if (!state.isDragging) return;
        const dx = event.clientX - state.lastDragX;
        const dy = event.clientY - state.lastDragY;

        state.offsetX -= dx / state.zoom;
        state.offsetY -= dy / state.zoom;

        state.lastDragX = event.clientX;
        state.lastDragY = event.clientY;
        
        clampOffsets();
        requestAnimationFrame(render);
    }

    function handlePanEnd() {
        state.isDragging = false;
        state.canvas.style.cursor = 'grab';
    }
    
    function clampOffsets() {
        const canvasWidth = state.canvas.width;
        const canvasHeight = state.canvas.height;

        // Max visible width/height in image coordinates at current zoom
        const maxVisibleWidth = canvasWidth / state.zoom;
        const maxVisibleHeight = canvasHeight / state.zoom;
        
        // Don't let image move too far left/up (allow some overpan)
        // state.offsetX = Math.max(-maxVisibleWidth / 2, state.offsetX);
        // state.offsetY = Math.max(-maxVisibleHeight / 2, state.offsetY);
        // state.offsetX = Math.min(state.imageFullWidth - maxVisibleWidth / 2, state.offsetX);
        // state.offsetY = Math.min(state.imageFullHeight - maxVisibleHeight / 2, state.offsetY);
        // Simpler: keep some part of the image visible if possible
        if (state.imageFullWidth * state.zoom > canvasWidth) { // Image wider than canvas
            state.offsetX = Math.max(0, Math.min(state.offsetX, state.imageFullWidth - maxVisibleWidth));
        } else { // Image narrower than canvas, center it
             state.offsetX = (state.imageFullWidth / 2) - (canvasWidth / (2 * state.zoom));
        }

        if (state.imageFullHeight * state.zoom > canvasHeight) { // Image taller than canvas
            state.offsetY = Math.max(0, Math.min(state.offsetY, state.imageFullHeight - maxVisibleHeight));
        } else { // Image shorter than canvas, center it
            state.offsetY = (state.imageFullHeight / 2) - (canvasHeight / (2 * state.zoom));
        }
    }

    function setupEventListeners() {
        state.canvas.addEventListener('wheel', handleZoom, { passive: false });
        state.canvas.addEventListener('mousedown', handlePanStart);
        state.canvas.addEventListener('mousemove', handlePanMove);
        state.canvas.addEventListener('mouseup', handlePanEnd);
        state.canvas.addEventListener('mouseleave', handlePanEnd); // Stop dragging if mouse leaves canvas
        
        // Handle resize
        // A proper resize handler would re-calculate zoom/offsets, here we just redraw
        // For simplicity, we are not implementing a full resize observer here.
        // window.addEventListener('resize', () => {
        //    state.canvas.width = state.container.clientWidth;
        //    state.canvas.height = state.container.clientHeight;
        //    render();
        // });
    }

    function init(urn, containerId) {
        state.container = document.getElementById(containerId);
        if (!state.container) {
            console.error(`Container with ID '${containerId}' not found.`);
            return;
        }
        state.urn = urn;

        // Clear container and reset state
        state.container.innerHTML = '';
        state.tileCache = {}; // Reset cache for new image

        state.canvas = document.createElement('canvas');
        state.canvas.style.width = '100%';
        state.canvas.style.height = '100%';
        state.canvas.style.cursor = 'grab';
        state.container.appendChild(state.canvas);
        
        // Set canvas resolution to match its display size
        state.canvas.width = state.container.clientWidth;
        state.canvas.height = state.container.clientHeight;
        
        state.ctx = state.canvas.getContext('2d');

        fetchInfo(urn).then(success => {
            if (success) {
                setupEventListeners();
                requestAnimationFrame(render);
            }
        });
    }

    // Public API
    return {
        init: init,
        // Expose for testing if needed, but not strictly necessary for users
        _getState: () => state, 
        _parseURNToIIIFBase: parseURNToIIIFBase 
    };
})();