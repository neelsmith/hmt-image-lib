(function(window) {
    'use strict';

    // --- URN Parsing and IIIF URL Construction ---
    function parseHMTURN(baseUrnString) { // Expects a base URN (no fragment)
        const parts = baseUrnString.split(':');
        if (parts.length !== 5 ) {
            console.error('Invalid CITE2 URN format for base URN', baseUrnString);
            throw new Error('Invalid CITE2 URN format. Expected 5 components for the base URN.');
        }
        
        const namespace = parts[2];
        const collectionComponent = parts[3];
        const objectId = parts[4];

        const collectionParts = collectionComponent.split('.');
        if (collectionParts.length !== 2) {
            console.error('Invalid collection component format in URN', collectionComponent);
            throw new Error('Invalid collection component format in URN. Expected two parts separated by a period.');
        }
        
        const iiifServer = 'http://www.homermultitext.org/iipsrv?IIIF=';
        const imagePathPrefix = `/project/homer/pyramidal/deepzoom/${namespace}/${collectionParts[0]}/${collectionParts[1]}`;
        const imageIdentifier = `${objectId}.tif`;
        
        return {
            baseURN: baseUrnString, 
            originalURN: baseUrnString, 
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

    function _parseROIFragment(urnStringWithFragment) {
        const parts = urnStringWithFragment.split('@');
        if (parts.length > 1 && parts[1].length > 0) {
            const roiValues = parts[1].split(',').map(v => parseFloat(v.trim()));
            
            if (roiValues.length === 4 && 
                roiValues.every(v => !isNaN(v) && v >= 0 && v <= 1)) {
                if (roiValues[2] > 0 && roiValues[3] > 0) { // Width and Height must be positive
                    return {
                        x: roiValues[0],
                        y: roiValues[1],
                        w: roiValues[2],
                        h: roiValues[3]
                    };
                } else {
                     console.warn("ROI fragment width and height must be positive:", parts[1]);
                }
            } else {
                console.warn("Invalid ROI fragment in URN (must be 4 comma-separated numbers between 0 and 1, e.g., @0.1,0.1,0.5,0.5):", parts[1]);
            }
        }
        return null;
    }

    class HMTImageViewer {
        constructor(element, urn, options = {}) {
            this.element = typeof element === 'string' ? document.getElementById(element) : element;
            if (!this.element) {
                throw new Error(`Element ${element} not found.`);
            }
            this.element.innerHTML = ''; 

            const baseUrnForViewer = urn.split('@')[0];
            this.urnData = parseHMTURN(baseUrnForViewer); 
            this.originalFullURN = urn; 

            this.options = options; 
            this.imageInfo = null; 
            this.canvas = null;
            this.ctx = null;
            this.currentScale = 1.0; 
            this.panX = 0; 
            this.panY = 0; 
            this.rectangles = []; // Stores { urn, x, y, w, h (percentages), fillColor }
            this.isPanning = false;
            this.isSelectingRect = false;
            this.isOptionKeyDown = false;
            this.isShiftKeyDown = false;
            this.dragStartPos = null; 
            this.currentMousePos = null; 
            this.lastRenderedImageUrl = null; 
            this.isLoadingImage = false;
            this.loadedImage = null; 
            this.currentActualReqX = 0;
            this.currentActualReqY = 0;

            this._init();
        }

        async _init() {
            try {
                await this._fetchInfoJson();
                this._createCanvas();
                this._setupInitialView();
                this._addEventListeners();
                this._render(); 
            } catch (error) {
                console.error("Error initializing viewer:", error);
                if (this.element) {
                    this.element.innerHTML = `<p style="color:red;">Error loading image: ${error.message}</p><p>URN: ${this.originalFullURN}</p><p>Info URL: ${this.urnData ? this.urnData.getInfoJsonUrl() : 'N/A'}</p>`;
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
            this.canvas.width = this.element.clientWidth || 500; 
            this.canvas.height = this.element.clientHeight || 400; 
            if(this.element.clientWidth === 0 || this.element.clientHeight === 0) {
                console.warn("Viewer container has zero width or height. Canvas may not be visible or sized correctly.");
            }
            this.element.appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d');
            this.canvas.style.cursor = 'grab';
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
            this.canvas.addEventListener('mousedown', this._handleMouseDown.bind(this));
            this.canvas.addEventListener('mousemove', this._handleMouseMove.bind(this));
            this.canvas.addEventListener('mouseup', this._handleMouseUp.bind(this));
            this.canvas.addEventListener('mouseleave', this._handleMouseLeave.bind(this));
            this.canvas.addEventListener('wheel', this._handleWheel.bind(this), { passive: false });
            
            window.addEventListener('keydown', this._handleKeyDown.bind(this));
            window.addEventListener('keyup', this._handleKeyUp.bind(this));
        }
        _getMousePosOnCanvas(event) { 
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
        }
        _canvasToImageCoordinates(canvasX, canvasY) { 
            if (!this.imageInfo) return { x: 0, y: 0 };
            const imageX = this.panX + (canvasX / this.currentScale);
            const imageY = this.panY + (canvasY / this.currentScale);
            return { x: imageX, y: imageY };
        }
        _imageToPercentageCoordinates(imageX, imageY, imageWidth, imageHeight) { 
            if (!this.imageInfo) return { x: 0, y: 0, w: 0, h: 0 };
            return {
                x: imageX / this.imageInfo.width,
                y: imageY / this.imageInfo.height,
                w: imageWidth / this.imageInfo.width,
                h: imageHeight / this.imageInfo.height
            };
        }
        _percentageToCanvasCoordinates(pctX, pctY, pctW, pctH) { 
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

        _getRandomFillColor() {
            const r = Math.floor(Math.random() * 256);
            const g = Math.floor(Math.random() * 256);
            const b = Math.floor(Math.random() * 256);
            return `rgba(${r},${g},${b},0.5)`; // 0.5 opacity
        }

        _handleMouseDown(event) { 
            event.preventDefault();
            this.dragStartPos = this._getMousePosOnCanvas(event);
            
            if (this.isOptionKeyDown) { 
                this.isSelectingRect = true;
            } else if (this.isShiftKeyDown) { 
                const clickPosCanvas = this._getMousePosOnCanvas(event);
                const clickPosImage = this._canvasToImageCoordinates(clickPosCanvas.x, clickPosCanvas.y);
                if (!this.imageInfo) return; 
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
                if (this.canvas) this.canvas.style.cursor = 'grabbing';
            }
        }
        _handleMouseMove(event) { 
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
            } else if (this.isSelectingRect && this.isOptionKeyDown) { 
                this._render(); 
            }
        }
        _handleMouseUp(event) { 
            event.preventDefault();
            if (this.canvas) { // Check if canvas exists
                if (!this.isOptionKeyDown && !this.isShiftKeyDown) { 
                    this.canvas.style.cursor = 'grab';
                } else if (this.isOptionKeyDown) {
                    this.canvas.style.cursor = 'crosshair';
                } else if (this.isShiftKeyDown) {
                    this.canvas.style.cursor = 'help';
                }
            }


            if (this.isPanning) {
                this.isPanning = false;
            } else if (this.isSelectingRect && this.isOptionKeyDown) { 
                this.isSelectingRect = false; 
                const rectEndPos = this._getMousePosOnCanvas(event);
                if (!this.imageInfo || !this.dragStartPos) return; 

                const startImgCoords = this._canvasToImageCoordinates(this.dragStartPos.x, this.dragStartPos.y);
                const endImgCoords = this._canvasToImageCoordinates(rectEndPos.x, rectEndPos.y);

                const imgRectX = Math.min(startImgCoords.x, endImgCoords.x);
                const imgRectY = Math.min(startImgCoords.y, endImgCoords.y);
                const imgRectW = Math.abs(startImgCoords.x - endImgCoords.x);
                const imgRectH = Math.abs(startImgCoords.y - endImgCoords.y);

                if (imgRectW > 1 && imgRectH > 1) { 
                    const pctCoords = this._imageToPercentageCoordinates(imgRectX, imgRectY, imgRectW, imgRectH);
                    pctCoords.x = Math.max(0, Math.min(1, pctCoords.x));
                    pctCoords.y = Math.max(0, Math.min(1, pctCoords.y));
                    pctCoords.w = Math.max(0, Math.min(1 - pctCoords.x, pctCoords.w));
                    pctCoords.h = Math.max(0, Math.min(1 - pctCoords.y, pctCoords.h));

                    if (pctCoords.w > 0.0001 && pctCoords.h > 0.0001) { 
                        const rectURN = `${this.urnData.baseURN}@${pctCoords.x.toFixed(4)},${pctCoords.y.toFixed(4)},${pctCoords.w.toFixed(4)},${pctCoords.h.toFixed(4)}`;
                        const fillColor = this._getRandomFillColor();
                        this.rectangles.push({ urn: rectURN, ...pctCoords, fillColor: fillColor });
                        
                        if (this.options.onRectangleSelected) {
                            const urnListString = this.rectangles.map(r => r.urn).join('\n');
                            this.options.onRectangleSelected(urnListString);
                        }
                    }
                }
                this._render(); 
            } else if (this.isSelectingRect && !this.isOptionKeyDown) { // Option key released before mouse up
                this.isSelectingRect = false;
                this._render(); 
            }
            this.dragStartPos = null;
            this.currentMousePos = null; 
        }
        _handleMouseLeave(event) { 
            if (this.isPanning) {
                this.isPanning = false;
                if (this.canvas && !this.isOptionKeyDown && !this.isShiftKeyDown) this.canvas.style.cursor = 'grab';
            }
            if (this.isSelectingRect && this.isOptionKeyDown) {
                this.currentMousePos = null; 
                this._render(); 
            } else if (this.isSelectingRect && !this.isOptionKeyDown) {
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
            const minPracticalScale = Math.min(minScaleForViewX, minScaleForViewY) / 4; 
            const maxPracticalScale = 10; 

            this.currentScale = Math.max(minPracticalScale, this.currentScale);
            this.currentScale = Math.min(maxPracticalScale, this.currentScale);

            this.panX = imgPointX - (mousePosCanvas.x / this.currentScale);
            this.panY = imgPointY - (mousePosCanvas.y / this.currentScale);
            
            this._render();
        }
        _handleKeyDown(event) { 
            if (event.key === 'Alt' || event.key === 'Option') {
                this.isOptionKeyDown = true;
                if (!this.isPanning && !this.isSelectingRect && this.canvas) this.canvas.style.cursor = 'crosshair';
            } else if (event.key === 'Shift') {
                this.isShiftKeyDown = true;
                if (!this.isPanning && !this.isSelectingRect && this.canvas) this.canvas.style.cursor = 'help';
            }
        }
        _handleKeyUp(event) { 
            if (event.key === 'Alt' || event.key === 'Option') {
                this.isOptionKeyDown = false;
                if (this.isSelectingRect) { 
                    this.isSelectingRect = false; 
                    this.currentMousePos = null; 
                    this._render(); 
                }
                if (this.canvas && !this.isShiftKeyDown && !this.isPanning) {
                    this.canvas.style.cursor = 'grab';
                }
            } else if (event.key === 'Shift') {
                this.isShiftKeyDown = false;
                if (this.canvas && !this.isOptionKeyDown && !this.isPanning) {
                    this.canvas.style.cursor = 'grab';
                }
            }
        }
        _render() {
            if (!this.imageInfo || !this.ctx) return;
            if (this.isLoadingImage && !(this.isSelectingRect && this.isOptionKeyDown && this.currentMousePos)) return;

            const canvasW = this.canvas.width;
            const canvasH = this.canvas.height;

            let sourceRegionW = canvasW / this.currentScale;
            let sourceRegionH = canvasH / this.currentScale;

            if (this.imageInfo.width * this.currentScale > canvasW) { 
                this.panX = Math.max(0, Math.min(this.panX, this.imageInfo.width - sourceRegionW));
            } else { 
                this.panX = (this.imageInfo.width - sourceRegionW) / 2;
            }
            if (this.imageInfo.height * this.currentScale > canvasH) { 
                this.panY = Math.max(0, Math.min(this.panY, this.imageInfo.height - sourceRegionH));
            } else { 
                this.panY = (this.imageInfo.height - sourceRegionH) / 2;
            }
            
            let reqRegionX = Math.round(this.panX);
            let reqRegionY = Math.round(this.panY);
            let reqRegionW = Math.round(sourceRegionW);
            let reqRegionH = Math.round(sourceRegionH);

            let effectiveReqX = Math.max(0, reqRegionX);
            let effectiveReqY = Math.max(0, reqRegionY);
            let effectiveReqW = reqRegionW;
            let effectiveReqH = reqRegionH;

            if (reqRegionX < 0) effectiveReqW = reqRegionW + reqRegionX; 
            if (reqRegionY < 0) effectiveReqH = reqRegionH + reqRegionY; 
            
            effectiveReqW = Math.min(effectiveReqW, this.imageInfo.width - effectiveReqX);
            effectiveReqH = Math.min(effectiveReqH, this.imageInfo.height - effectiveReqY);
            
            if (effectiveReqW <= 0 || effectiveReqH <= 0) {
                this.ctx.clearRect(0, 0, canvasW, canvasH);
                this.ctx.fillStyle = '#DDD'; 
                this.ctx.fillRect(0,0,canvasW, canvasH);
                this.ctx.fillStyle = 'black';
                this.ctx.textAlign = 'center';
                this.ctx.fillText("Zoomed out too far or invalid region", canvasW/2, canvasH/2);
                this._drawRectangles(); 
                if (this.isSelectingRect && this.isOptionKeyDown && this.dragStartPos && this.currentMousePos) this._drawTemporarySelectionRect();
                return;
            }
            
            const regionStr = `${effectiveReqX},${effectiveReqY},${effectiveReqW},${effectiveReqH}`;
            const sizeStr = `!${Math.ceil(canvasW)},${Math.ceil(canvasH)}`;
            const imageUrl = this.urnData.getFullIIIFUrl(regionStr, sizeStr);

            const shouldSkipLoad = imageUrl === this.lastRenderedImageUrl && this.loadedImage && 
                                    !(this.isSelectingRect && this.isOptionKeyDown && this.currentMousePos);

            if (shouldSkipLoad) { 
                this.ctx.clearRect(0, 0, canvasW, canvasH);
                this._drawLoadedImage(this.loadedImage); 
                this._drawRectangles();
                if (this.isSelectingRect && this.isOptionKeyDown && this.dragStartPos && this.currentMousePos) {
                    this._drawTemporarySelectionRect();
                }
                return;
            }
            
            if (this.loadedImage && (this.isSelectingRect && this.isOptionKeyDown && this.currentMousePos) && imageUrl === this.lastRenderedImageUrl) {
                this.ctx.clearRect(0, 0, canvasW, canvasH);
                this._drawLoadedImage(this.loadedImage);
                this._drawRectangles();
                this._drawTemporarySelectionRect(); 
                return;
            }

            this.isLoadingImage = true;
            const img = new Image();
            img.crossOrigin = "anonymous";
            
            img.onload = () => {
                this.isLoadingImage = false;
                this.loadedImage = img; 
                this.lastRenderedImageUrl = imageUrl;
                this.currentActualReqX = effectiveReqX;
                this.currentActualReqY = effectiveReqY;

                this.ctx.clearRect(0, 0, canvasW, canvasH);
                this._drawLoadedImage(img);
                this._drawRectangles();
                if (this.isSelectingRect && this.isOptionKeyDown && this.dragStartPos && this.currentMousePos) {
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
            };
            img.src = imageUrl;
        }
        _drawLoadedImage(img) { 
            if (!img || !this.imageInfo) return;
            const canvasW = this.canvas.width;
            const canvasH = this.canvas.height;
            
            let drawX = (this.currentActualReqX - this.panX) * this.currentScale;
            let drawY = (this.currentActualReqY - this.panY) * this.currentScale;
            
            this.ctx.fillStyle = '#EEE'; 
            this.ctx.fillRect(0, 0, canvasW, canvasH);
            this.ctx.drawImage(img, drawX, drawY, img.width, img.height);
        }

        _drawRectangles() {
            if (!this.imageInfo || !this.ctx) return; 
            
            this.rectangles.forEach(rect => {
                const canvasRect = this._percentageToCanvasCoordinates(rect.x, rect.y, rect.w, rect.h);
                this.ctx.fillStyle = rect.fillColor; 
                this.ctx.fillRect(canvasRect.x, canvasRect.y, canvasRect.w, canvasRect.h);
            });
        }

        _drawTemporarySelectionRect() { 
            if (!this.dragStartPos || !this.currentMousePos || !this.isOptionKeyDown) return; 
            
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

        removeRectangle(rectangleURNToRemove) {
            const initialLength = this.rectangles.length;
            this.rectangles = this.rectangles.filter(rect => rect.urn !== rectangleURNToRemove);

            if (this.rectangles.length < initialLength) { 
                this._render(); 
                if (this.options.onRectangleSelected) {
                    const urnListString = this.rectangles.map(r => r.urn).join('\n');
                    this.options.onRectangleSelected(urnListString); 
                }
                return true; 
            }
            return false; 
        }
        
        clearAllRectangles() {
            if (this.rectangles.length > 0) {
                this.rectangles = [];
                this._render();
                if (this.options.onRectangleSelected) {
                    this.options.onRectangleSelected(""); 
                }
            }
        }
    }

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
        },
        getIIIFImageUrl: function(urnString, outputWidth, outputHeight) {
            if (!urnString || typeof urnString !== 'string' || urnString.trim() === "") {
                throw new Error("URN string is required and must be non-empty.");
            }
        
            const baseUrnForParsing = urnString.split('@')[0];
            const urnData = parseHMTURN(baseUrnForParsing); 
            const roiFragment = _parseROIFragment(urnString); 
        
            let regionParameter = 'full';
            if (roiFragment) {
                const pctX = Math.round(roiFragment.x * 100);
                const pctY = Math.round(roiFragment.y * 100);
                const pctW = Math.round(roiFragment.w * 100);
                const pctH = Math.round(roiFragment.h * 100);
                regionParameter = `pct:${pctX},${pctY},${pctW},${pctH}`;
            }
        
            let sizeParameter = 'full'; 
            
            const w = parseInt(outputWidth, 10);
            const h = parseInt(outputHeight, 10);
        
            const hasWidth = !isNaN(w) && w > 0;
            const hasHeight = !isNaN(h) && h > 0;
        
            if (hasWidth && hasHeight) {
                sizeParameter = `!${w},${h}`; 
            } else if (hasWidth) {
                sizeParameter = `${w},`;    
            } else if (hasHeight) {
                sizeParameter = `,${h}`;    
            }
        
            const rotationParameter = '0';
            const qualityParameter = 'default'; 
            const formatParameter = 'jpg';
        
            return `${urnData.iiifServer}${urnData.iiifImagePath}/${regionParameter}/${sizeParameter}/${rotationParameter}/${qualityParameter}.${formatParameter}`;
        }
    };

})(window);