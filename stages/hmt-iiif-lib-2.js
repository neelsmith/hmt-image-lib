(function(window) {
    'use strict';

    // --- URN Parsing and IIIF URL Construction ---
    function parseHMTURN(urnString) {
        // ... (rest of the function remains the same) ...
        const parts = urnString.split(':');
        if (parts.length < 5 && !urnString.includes('@')) { 
             // Allow URNs with fragments like @x,y,w,h by checking if @ is present
             // A URN like urn:cite2:hmt:vaimg.2017a:VA012RN_0013@0.1,0.1,0.1,0.1 should still parse its base
            let baseUrnForCheck = urnString.split('@')[0];
            if (baseUrnForCheck.split(':').length < 5) {
                console.error('Invalid CITE2 URN format', urnString);
                throw new Error('Invalid CITE2 URN format. Expected 5 components for the base URN.');
            }
        }
        
        const baseURN = urnString.split('@')[0];
        const baseURNParts = baseURN.split(':'); // Parse from the base URN for components

        const namespace = baseURNParts[2];
        const collectionComponent = baseURNParts[3];
        const objectId = baseURNParts[4];

        const collectionParts = collectionComponent.split('.');
        if (collectionParts.length !== 2) {
            console.error('Invalid collection component format in URN', collectionComponent);
            throw new Error('Invalid collection component format in URN. Expected two parts separated by a period.');
        }
        
        const iiifServer = 'http://www.homermultitext.org/iipsrv?IIIF=';
        const imagePathPrefix = `/project/homer/pyramidal/deepzoom/${namespace}/${collectionParts[0]}/${collectionParts[1]}`;
        const imageIdentifier = `${objectId}.tif`;
        
        return {
            baseURN: baseURN,
            originalURN: urnString,
            namespace: namespace,
            collectionComponent: collectionComponent,
            objectId: objectId,
            collectionParts: collectionParts,
            iiifServer: iiifServer,
            iiifImagePath: `${imagePathPrefix}/${imageIdentifier}`,
            getFullIIIFUrl: function(region = 'full', size = 'max', rotation = '0', quality = 'default', format = 'jpg') {
                return `${this.iiifServer}${this.iiifImagePath}/${region}/${size}/${rotation}/${quality}.${format}`;
            },
            getInfoJsonUrl: function() {
                return `${this.iiifServer}${this.iiifImagePath}/info.json`;
            }
        };
    }


    // --- HMTImageViewer Class ---
    class HMTImageViewer {
        constructor(element, urn, options = {}) {
            this.element = typeof element === 'string' ? document.getElementById(element) : element;
            if (!this.element) {
                throw new Error(`Element ${element} not found.`);
            }
            this.element.innerHTML = ''; // Clear container

            this.urnData = parseHMTURN(urn);
            this.options = options; // { onRectangleSelected: func, onQuery: func }

            this.imageInfo = null; // From info.json
            this.canvas = null;
            this.ctx = null;
            
            this.currentScale = 1.0; 
            this.panX = 0; 
            this.panY = 0; 

            this.rectangles = []; // { urn, x, y, w, h (percentages) }

            this.isPanning = false;
            this.isSelectingRect = false;
            this.isOptionKeyDown = false;
            this.isShiftKeyDown = false;
            this.dragStartPos = null; 
            this.currentMousePos = null; 

            this.lastRenderedImageUrl = null; 
            this.isLoadingImage = false;
            this.loadedImage = null; // To store the currently drawn image object

            // NEW: Store the requested region's top-left for drawing
            this.currentReqRegionX = 0;
            this.currentReqRegionY = 0;

            this._init();
        }

        async _init() {
            try {
                await this._fetchInfoJson();
                this._createCanvas();
                this._setupInitialView();
                this._addEventListeners();
                this._render(); // Initial render
            } catch (error) {
                console.error("Error initializing viewer:", error);
                if (this.element) {
                    this.element.innerHTML = `<p style="color:red;">Error loading image: ${error.message}</p><p>URN: ${this.urnData.originalURN}</p><p>Info URL: ${this.urnData ? this.urnData.getInfoJsonUrl() : 'N/A'}</p>`;
                }
            }
        }

        async _fetchInfoJson() {
            const infoUrl = this.urnData.getInfoJsonUrl();
            try {
                const response = await fetch(infoUrl, { mode: 'cors' });
                if (!response.ok) {
                    throw new Error(`Failed to fetch info.json (status ${response.status}) from ${infoUrl}`);
                }
                this.imageInfo = await response.json();
            } catch (error) {
                console.error(`Error fetching or parsing info.json from ${infoUrl}:`, error);
                throw error; 
            }
        }

        _createCanvas() {
            this.canvas = document.createElement('canvas');
            // Set canvas size based on container. Ensure container has definite dimensions.
            this.canvas.width = this.element.clientWidth || 500; // Fallback width
            this.canvas.height = this.element.clientHeight || 400; // Fallback height
            if(this.element.clientWidth === 0 || this.element.clientHeight === 0) {
                console.warn("Viewer container has zero width or height. Canvas may not be visible or sized correctly.");
            }
            this.element.appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d');
        }

        _setupInitialView() {
            if (!this.imageInfo || !this.canvas) return;
            const W = this.imageInfo.width;
            const H = this.imageInfo.height;
            const canvasW = this.canvas.width;
            const canvasH = this.canvas.height;

            const scaleX = canvasW / W;
            const scaleY = canvasH / H;
            this.currentScale = Math.min(scaleX, scaleY);

            this.panX = (W - (canvasW / this.currentScale)) / 2;
            this.panY = (H - (canvasH / this.currentScale)) / 2;
            
            if (W * this.currentScale <= canvasW) this.panX = 0;
            if (H * this.currentScale <= canvasH) this.panY = 0;
        }
        
        _addEventListeners() {
            // ... (event listeners remain the same) ...
            this.canvas.addEventListener('mousedown', this._handleMouseDown.bind(this));
            this.canvas.addEventListener('mousemove', this._handleMouseMove.bind(this));
            this.canvas.addEventListener('mouseup', this._handleMouseUp.bind(this));
            this.canvas.addEventListener('mouseleave', this._handleMouseLeave.bind(this));
            this.canvas.addEventListener('wheel', this._handleWheel.bind(this), { passive: false }); // passive:false for preventDefault
            
            window.addEventListener('keydown', this._handleKeyDown.bind(this));
            window.addEventListener('keyup', this._handleKeyUp.bind(this));
        }

        _getMousePosOnCanvas(event) {
            // ... (remains the same) ...
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
        }

        _canvasToImageCoordinates(canvasX, canvasY) {
            // ... (remains the same) ...
            if (!this.imageInfo) return { x: 0, y: 0 };
            const imageX = this.panX + (canvasX / this.currentScale);
            const imageY = this.panY + (canvasY / this.currentScale);
            return { x: imageX, y: imageY };
        }

        _imageToPercentageCoordinates(imageX, imageY, imageWidth, imageHeight) {
            // ... (remains the same) ...
            if (!this.imageInfo) return { x: 0, y: 0, w: 0, h: 0 };
            return {
                x: imageX / this.imageInfo.width,
                y: imageY / this.imageInfo.height,
                w: imageWidth / this.imageInfo.width,
                h: imageHeight / this.imageInfo.height
            };
        }

        _percentageToCanvasCoordinates(pctX, pctY, pctW, pctH) {
            // ... (remains the same) ...
            if (!this.imageInfo) return { x: 0, y: 0, w: 0, h: 0 };
            const imgX = pctX * this.imageInfo.width;
            const imgY = pctY * this.imageInfo.height;
            const imgW = pctW * this.imageInfo.width;
            const imgH = pctH * this.imageInfo.height;

            return {
                x: (imgX - this.panX) * this.currentScale,
                y: (imgY - this.panY) * this.currentScale,
                w: imgW * this.currentScale,
                h: imgH * this.currentScale
            };
        }

        _handleMouseDown(event) {
            // ... (remains the same) ...
            event.preventDefault();
            this.dragStartPos = this._getMousePosOnCanvas(event);
            
            if (this.isOptionKeyDown) { 
                this.isSelectingRect = true;
            } else if (this.isShiftKeyDown) { 
                const clickPosCanvas = this._getMousePosOnCanvas(event);
                const clickPosImage = this._canvasToImageCoordinates(clickPosCanvas.x, clickPosCanvas.y);
                if (!this.imageInfo) return; // Guard against missing imageInfo
                const clickPosPct = {
                    x: clickPosImage.x / this.imageInfo.width,
                    y: clickPosImage.y / this.imageInfo.height
                };

                const matchingRects = this.rectangles.filter(rect => 
                    clickPosPct.x >= rect.x && clickPosPct.x <= rect.x + rect.w &&
                    clickPosPct.y >= rect.y && clickPosPct.y <= rect.y + rect.h
                );
                
                if (this.options.onQuery) {
                    this.options.onQuery(matchingRects.map(r => r.urn));
                }
            } else { 
                this.isPanning = true;
            }
        }

        _handleMouseMove(event) {
            // ... (remains the same) ...
            event.preventDefault();
            if (!this.dragStartPos) return;

            this.currentMousePos = this._getMousePosOnCanvas(event);

            if (this.isPanning) {
                const dx = (this.currentMousePos.x - this.dragStartPos.x) / this.currentScale;
                const dy = (this.currentMousePos.y - this.dragStartPos.y) / this.currentScale;
                
                this.panX -= dx;
                this.panY -= dy;
                
                this.dragStartPos = this.currentMousePos; 
                this._render();
            } else if (this.isSelectingRect) {
                this._render(); 
            }
        }

        _handleMouseUp(event) {
            // ... (remains the same) ...
            event.preventDefault();
            if (this.isPanning) {
                this.isPanning = false;
            } else if (this.isSelectingRect) {
                this.isSelectingRect = false;
                const rectEndPos = this._getMousePosOnCanvas(event);

                if (!this.imageInfo) return; // Guard

                const startImgCoords = this._canvasToImageCoordinates(this.dragStartPos.x, this.dragStartPos.y);
                const endImgCoords = this._canvasToImageCoordinates(rectEndPos.x, rectEndPos.y);

                const imgRectX = Math.min(startImgCoords.x, endImgCoords.x);
                const imgRectY = Math.min(startImgCoords.y, endImgCoords.y);
                const imgRectW = Math.abs(startImgCoords.x - endImgCoords.x);
                const imgRectH = Math.abs(startImgCoords.y - endImgCoords.y);

                if (imgRectW > 1 && imgRectH > 1) { // Min dimensions for a rect
                    const pctCoords = this._imageToPercentageCoordinates(imgRectX, imgRectY, imgRectW, imgRectH);
                    pctCoords.x = Math.max(0, Math.min(1, pctCoords.x));
                    pctCoords.y = Math.max(0, Math.min(1, pctCoords.y));
                    pctCoords.w = Math.max(0, Math.min(1 - pctCoords.x, pctCoords.w));
                    pctCoords.h = Math.max(0, Math.min(1 - pctCoords.y, pctCoords.h));

                    if (pctCoords.w > 0 && pctCoords.h > 0) {
                        const rectURN = `${this.urnData.baseURN}@${pctCoords.x.toFixed(4)},${pctCoords.y.toFixed(4)},${pctCoords.w.toFixed(4)},${pctCoords.h.toFixed(4)}`;
                        this.rectangles.push({ urn: rectURN, ...pctCoords });
                        
                        if (this.options.onRectangleSelected) {
                            const urnListString = this.rectangles.map(r => r.urn).join('\n');
                            this.options.onRectangleSelected(urnListString);
                        }
                    }
                }
                this._render(); 
            }
            this.dragStartPos = null;
            this.currentMousePos = null;
        }
        
        _handleMouseLeave(event) {
            // ... (remains the same) ...
            if (this.isPanning) {
                this.isPanning = false;
                this.dragStartPos = null;
            }
            if (this.isSelectingRect) {
                // Don't finalize rectangle if mouse leaves, just stop drawing temporary one
                this.isSelectingRect = false; 
                this.dragStartPos = null;
                this.currentMousePos = null;
                this._render(); 
            }
        }

        _handleWheel(event) {
            event.preventDefault();
            if (!this.imageInfo || !this.canvas) return;

            const zoomFactor = 1.1;
            const mousePosCanvas = this._getMousePosOnCanvas(event);
            
            const imgPointX = this.panX + mousePosCanvas.x / this.currentScale;
            const imgPointY = this.panY + mousePosCanvas.y / this.currentScale;

            if (event.deltaY < 0) { 
                this.currentScale *= zoomFactor;
            } else { 
                this.currentScale /= zoomFactor;
            }
            
            const minScaleForViewX = this.canvas.width / this.imageInfo.width;
            const minScaleForViewY = this.canvas.height / this.imageInfo.height;
            const minPracticalScale = Math.min(minScaleForViewX, minScaleForViewY) / 4; // Allow zooming out more
            const maxPracticalScale = 10; // Arbitrary max scale, e.g., 10x native resolution

            this.currentScale = Math.max(minPracticalScale, this.currentScale);
            this.currentScale = Math.min(maxPracticalScale, this.currentScale);

            this.panX = imgPointX - (mousePosCanvas.x / this.currentScale);
            this.panY = imgPointY - (mousePosCanvas.y / this.currentScale);
            
            this._render();
        }

        _handleKeyDown(event) {
            // ... (remains the same) ...
            if (event.key === 'Alt' || event.key === 'Option') {
                this.isOptionKeyDown = true;
                this.canvas.style.cursor = 'crosshair';
            } else if (event.key === 'Shift') {
                this.isShiftKeyDown = true;
                this.canvas.style.cursor = 'help';
            }
        }

        _handleKeyUp(event) {
            // ... (remains the same) ...
            if (event.key === 'Alt' || event.key === 'Option') {
                this.isOptionKeyDown = false;
                 this.canvas.style.cursor = 'grab';
            } else if (event.key === 'Shift') {
                this.isShiftKeyDown = false;
                 this.canvas.style.cursor = 'grab';
            }
        }

        _render() {
            if (!this.imageInfo || !this.ctx) return;
            if (this.isLoadingImage && !this.isSelectingRect) return; // If loading, only allow re-render for temp rect draw

            const canvasW = this.canvas.width;
            const canvasH = this.canvas.height;

            let sourceRegionW = canvasW / this.currentScale;
            let sourceRegionH = canvasH / this.currentScale;

            // Pan clamping logic:
            // If image is wider than viewport, panX is between 0 and (imageWidth - viewportWidthInImageCoords)
            // If image is narrower than viewport (zoomed out), panX should center it.
            if (this.imageInfo.width * this.currentScale > canvasW) { // Image wider than canvas
                this.panX = Math.max(0, Math.min(this.panX, this.imageInfo.width - sourceRegionW));
            } else { // Image narrower than or equal to canvas width, center it
                this.panX = (this.imageInfo.width - sourceRegionW) / 2;
            }
            if (this.imageInfo.height * this.currentScale > canvasH) { // Image taller than canvas
                this.panY = Math.max(0, Math.min(this.panY, this.imageInfo.height - sourceRegionH));
            } else { // Image shorter than or equal to canvas height, center it
                this.panY = (this.imageInfo.height - sourceRegionH) / 2;
            }
            
            // Define reqRegion based on current pan and scale
            let reqRegionX = Math.round(this.panX);
            let reqRegionY = Math.round(this.panY);
            let reqRegionW = Math.round(sourceRegionW);
            let reqRegionH = Math.round(sourceRegionH);

            // Store the actual values that will be used for the IIIF request (or for drawing the cached image)
            // These are adjusted for image boundaries.
            this.currentReqRegionX_unclamped = reqRegionX; // For draw offset calculation
            this.currentReqRegionY_unclamped = reqRegionY; // For draw offset calculation

            // Adjust requested region to be within image bounds for IIIF
            let effectiveReqX = Math.max(0, reqRegionX);
            let effectiveReqY = Math.max(0, reqRegionY);
            let effectiveReqW = reqRegionW;
            let effectiveReqH = reqRegionH;

            if (reqRegionX < 0) effectiveReqW = reqRegionW + reqRegionX; // reqRegionX is negative, so this reduces width
            if (reqRegionY < 0) effectiveReqH = reqRegionH + reqRegionY; // reqRegionY is negative, so this reduces height
            
            effectiveReqW = Math.min(effectiveReqW, this.imageInfo.width - effectiveReqX);
            effectiveReqH = Math.min(effectiveReqH, this.imageInfo.height - effectiveReqY);
            
            if (effectiveReqW <= 0 || effectiveReqH <= 0) {
                this.ctx.clearRect(0, 0, canvasW, canvasH);
                this.ctx.fillStyle = '#DDD'; // Light gray background
                this.ctx.fillRect(0,0,canvasW, canvasH);
                this.ctx.fillStyle = 'black';
                this.ctx.fillText("Zoomed out too far or invalid region", 10, 20);
                this._drawRectangles(); 
                if (this.isSelectingRect && this.dragStartPos && this.currentMousePos) this._drawTemporarySelectionRect();
                return;
            }
            
            const regionStr = `${effectiveReqX},${effectiveReqY},${effectiveReqW},${effectiveReqH}`;
            
            // Size for IIIF: Request image to fit canvas dimensions, IIIF server scales.
            // Use !w,h to maintain aspect ratio but fit inside w,h
            const sizeStr = `!${Math.ceil(canvasW)},${Math.ceil(canvasH)}`;
            
            const imageUrl = this.urnData.getFullIIIFUrl(regionStr, sizeStr);

            if (imageUrl === this.lastRenderedImageUrl && this.loadedImage && !this.isSelectingRect) { 
                this.ctx.clearRect(0, 0, canvasW, canvasH);
                this._drawLoadedImage(this.loadedImage); 
                this._drawRectangles();
                // No temporary selection rect here as !this.isSelectingRect
                return;
            }
            
            // If only selecting rectangle, the base image is the same. Redraw.
            if (this.loadedImage && this.isSelectingRect && imageUrl === this.lastRenderedImageUrl) {
                this.ctx.clearRect(0, 0, canvasW, canvasH);
                this._drawLoadedImage(this.loadedImage);
                this._drawRectangles();
                if (this.dragStartPos && this.currentMousePos) { // Ensure these exist
                    this._drawTemporarySelectionRect();
                }
                return;
            }

            // Fetch new image
            this.isLoadingImage = true;
            const img = new Image();
            img.crossOrigin = "anonymous";
            
            img.onload = () => {
                this.isLoadingImage = false;
                this.loadedImage = img; 
                this.lastRenderedImageUrl = imageUrl;
                
                // Store the top-left of the region *actually fetched and contained in img*
                // This is `effectiveReqX` and `effectiveReqY`
                this.currentActualReqX = effectiveReqX;
                this.currentActualReqY = effectiveReqY;

                this.ctx.clearRect(0, 0, canvasW, canvasH);
                this._drawLoadedImage(img);
                this._drawRectangles();
                if (this.isSelectingRect && this.dragStartPos && this.currentMousePos) {
                    this._drawTemporarySelectionRect();
                }
            };
            img.onerror = (e) => {
                this.isLoadingImage = false;
                console.error("Error loading image tile:", imageUrl, e);
                this.ctx.clearRect(0,0, canvasW, canvasH);
                this.ctx.fillStyle = 'red';
                this.ctx.textAlign = 'center';
                this.ctx.fillText('Error loading image. Check console.', canvasW/2, canvasH/2);
                // Potentially clear lastRenderedImageUrl so it retries if error was transient
                // this.lastRenderedImageUrl = null; 
            };
            img.src = imageUrl;
        }
        
        _drawLoadedImage(img) {
            if (!img || !this.imageInfo) return;
            const canvasW = this.canvas.width;
            const canvasH = this.canvas.height;

            // The `img` object is the IIIF region `currentActualReqX,currentActualReqY,effectiveReqW,effectiveReqH`
            // scaled by the server to fit `!canvasW,canvasH`.
            // Its dimensions are `img.width`, `img.height`.

            // We want to draw this `img` onto the canvas.
            // The top-left of the viewport (this.panX, this.panY) should map to canvas (0,0).
            // The `img` data starts at (this.currentActualReqX, this.currentActualReqY) in full image coordinates.
            // So, the canvas X where img should be drawn is (this.currentActualReqX - this.panX) * this.currentScale.
            // And canvas Y is (this.currentActualReqY - this.panY) * this.currentScale.
            
            let drawX = (this.currentActualReqX - this.panX) * this.currentScale;
            let drawY = (this.currentActualReqY - this.panY) * this.currentScale;
            
            // Fill background for areas not covered by image (e.g. if aspect ratio differs or zoomed out)
            this.ctx.fillStyle = '#EEE'; // A light background color
            this.ctx.fillRect(0, 0, canvasW, canvasH);

            this.ctx.drawImage(img, drawX, drawY, img.width, img.height);
        }

        _drawRectangles() {
            // ... (remains the same) ...
            if (!this.imageInfo) return; // Guard
            this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)'; 
            this.ctx.lineWidth = 2;
            this.rectangles.forEach(rect => {
                const canvasRect = this._percentageToCanvasCoordinates(rect.x, rect.y, rect.w, rect.h);
                this.ctx.strokeRect(canvasRect.x, canvasRect.y, canvasRect.w, canvasRect.h);
            });
        }

        _drawTemporarySelectionRect() {
            // ... (remains the same) ...
            if (!this.dragStartPos || !this.currentMousePos) return;
            this.ctx.fillStyle = 'rgba(0, 100, 255, 0.3)'; 
            this.ctx.strokeStyle = 'rgba(0, 100, 255, 0.8)';
            this.ctx.lineWidth = 1;
            const x = Math.min(this.dragStartPos.x, this.currentMousePos.x);
            const y = Math.min(this.dragStartPos.y, this.currentMousePos.y);
            const w = Math.abs(this.dragStartPos.x - this.currentMousePos.x);
            const h = Math.abs(this.dragStartPos.y - this.currentMousePos.y);
            this.ctx.fillRect(x, y, w, h);
            this.ctx.strokeRect(x, y, w, h);
        }
    }

    // --- Expose Library ---
    window.HMTImageLibrary = {
        createViewer: function(element, urn, options) {
            try {
                return new HMTImageViewer(element, urn, options);
            } catch (error) {
                console.error("Failed to create HMTImageViewer:", error);
                const targetElement = typeof element === 'string' ? document.getElementById(element) : element;
                if (targetElement) {
                    targetElement.innerHTML = `<p style="color:red;">Failed to initialize viewer: ${error.message}</p>`;
                }
                return null;
            }
        }
    };

})(window);