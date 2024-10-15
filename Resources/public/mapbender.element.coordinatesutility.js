/*jslint browser: true, nomen: true*/
/*globals initDropdown, Mapbender, OpenLayers, proj4, Proj4js, _, jQuery*/

(function ($) {
    'use strict';

    $.widget("mapbender.mbCoordinatesUtility", {
        options: {
            srsList: [],
            addMapSrsList: true,
            zoomlevel: 6
        },
        mapClickActive: false,
        isPopUpDialog: false,
        callback: null,
        mbMap: null,
        highlightLayer: null,
        currentMapCoordinate: null,
        transformedCoordinate: null,
        lon: null,
        lat: null,
        lonLatReversed: false,

        DECIMAL_ANGULAR: 6,
        DECIMAL_METRIC: 2,
        STRING_SEPARATOR: ' ',

        _create: function () {
            var widget = this;
            Mapbender.elementRegistry.waitReady('.mb-element-map').then(function (mbMap) {
                widget.mbMap = mbMap;
                widget._setup();
            });
        },

        _setup: function () {
            this.highlightLayer = window.Mapbender.vectorLayerPool.getElementLayer(this, 0);
            this.isPopUpDialog = !this.element.closest('.sidePane,.sideContent').length;
            this._initializeMissingSrsDefinitions(this.options.srsList);
            this._setupButtons();
            this._setupSrsDropdown();
            this._setupEventListeners();
            $('select', this.element.trigger('change'));
            this._trigger('ready');
        },

        _initializeMissingSrsDefinitions: function (srsList) {
            if (!srsList || !srsList.length) {
                return;
            }
            srsList.forEach(function (srs) {
                if (window.proj4 && (typeof proj4.defs[srs.name] === "undefined")) {
                    proj4.defs(srs.name, srs.definition);
                }
                if (window.Proj4js && (typeof Proj4js.defs[srs.name] === "undefined")) {
                    Proj4js.defs[srs.name] = srs.definition;
                }
            });
            if (window.proj4 && (((window.ol || {}).proj || {}).proj4 || {}).register) {
                ol.proj.proj4.register(window.proj4);
            }
        },

        _setupButtons: function () {
            var widget = this;
            $('.-fn-copy-clipboard', widget.element).on('click', this._copyToClipboard);
            $('.center-map', widget.element).on('click', $.proxy(widget._centerMap, widget));
            if (!widget.isPopUpDialog) {
                var coordinateSearchButton = $('.coordinate-search', this.element);
                coordinateSearchButton.on('click', function () {
                    if ($(this).hasClass('active')) {
                        widget.deactivate();
                        this.blur();
                    } else {
                        widget.activate();
                    }
                });
                coordinateSearchButton.removeClass('hidden');
            }
        },

        _setupSrsDropdown: function () {
            var widget = this,
                dropdown = $('select.srs', widget.element);

            if (dropdown.children().length === 0) {
                var srsList = this._getDropdownSrsList();
                if (!srsList.length) {
                    Mapbender.error(Mapbender.trans("mb.coordinatesutility.widget.error.noSrs"));
                    return;
                }
                dropdown.append(srsList.map(function (srs) {
                    return $('<option>').val(srs.name).text(srs.title || srs.name);
                }));
            }
            var $wrapper = dropdown.parent('.dropdown');
            if ($wrapper.length && initDropdown) {
                initDropdown.call($('.dropdown', this.element));
            }
        },

        _getDropdownSrsList: function () {
            var srsList = (this.options.srsList || []).slice();
            if (this.options.addMapSrsList) {
                var mapSrs = this.mbMap.getAllSrs();
                var srsNames = srsList.map(function (srs) {
                    return srs.name;
                });
                mapSrs.forEach(function (srs) {
                    if (srsNames.indexOf(srs.name) === -1) {
                        srsList.push(srs);
                    }
                });
            }
            return srsList;
        },

        _isValidSRS: function (srs) {
            if (window.proj4) {
                return typeof proj4.defs[srs] !== "undefined";
            } else if (window.Proj4js) {
                return typeof Proj4js.defs[srs] !== "undefined";
            } else {
                throw new Error("Missing proj4js library");
            }
        },

        _setupEventListeners: function () {
            var widget = this;
            $(document).on('mbmapsrschanged', $.proxy(widget._resetFields, widget));
            $('select.srs', this.element).on('change', function () {
                widget.lonLatReversed = widget._isLonLatReversed($(this).val());
                $('input.input-coordinate', widget.element).attr("placeholder", widget.lonLatReversed ? "latitude / longitude" : "longitude / latitude");
                widget._recalculateDisplayCoordinate($(this).val());
            });
            $('input.input-coordinate', widget.element).on('change', $.proxy(widget._transformCoordinateToMapSrs, widget));
            this.mbMap.element.on('mbmapclick', function (event, data) {
                widget._mapClick(event, data);
            });
        },

        _isLonLatReversed: function (srsName) {
            var srsList = this.options.srsList || [];
            var selectedSrs = srsList.find(function (srs) {
                return srs.name === srsName;
            });

            return selectedSrs && selectedSrs.axisOrder === 'latlon';
        },

        popup: function () {
            var widget = this;
            if (!widget.popupWindow || !widget.popupWindow.$element) {
                widget.popupWindow = new Mapbender.Popup2({
                    title: this.element.attr('data-title'),
                    draggable: true,
                    resizable: true,
                    modal: false,
                    closeButton: false,
                    closeOnESC: false,
                    destroyOnClose: false,
                    detachOnClose: false,
                    content: this.element,
                    width: 450,
                    height: 400,
                    buttons: {}
                });
                widget.popupWindow.$element.on('close', function () {
                    widget.close();
                });
            }
            widget.popupWindow.$element.removeClass('hidden');
        },

        open: function (callback) {
            this.callback = callback;
            this.popup();
            this.activate();
        },

        close: function () {
            if (this.popupWindow && this.popupWindow.$element) {
                this.popupWindow.$element.addClass('hidden');
            }
            if (this.callback) {
                this.callback.call();
                this.callback = null;
            }
            this.deactivate();
            this._resetFields();
        },

        activate: function () {
            this.mbMap.map.element.addClass('crosshair');
            Mapbender.vectorLayerPool.showElementLayers(this);
            $('.coordinate-search', this.element).addClass('active');
            this.mapClickActive = true;
        },

        deactivate: function () {
            this.mbMap.map.element.removeClass('crosshair');
            Mapbender.vectorLayerPool.hideElementLayers(this);
            $('.coordinate-search', this.element).removeClass('active');
            this.mapClickActive = false;
        },

        reveal: function () {
            this.activate();
            this._showFeature();
        },

        hide: function () {
            this.deactivate();
            this._removeFeature();
        },

        _mapClick: function (event, data) {
            if (!this.mapClickActive) {
                return;
            }
            event.stopPropagation();
            var x = this.lon = data.coordinate[0];
            var y = this.lat = data.coordinate[1];
            var mapSrs = this.mbMap.getModel().getCurrentProjectionCode();
            this.currentMapCoordinate = this._formatOutputString(x, y, mapSrs);

            var selectedSrs = $('select.srs', this.element).val();
            if (selectedSrs) {
                if (selectedSrs !== mapSrs) {
                    var transformed = this._transformCoordinate(x, y, selectedSrs, mapSrs);
                    this.transformedCoordinate = this.lonLatReversed ? this._formatOutputString(transformed.y, transformed.x, selectedSrs) : this._formatOutputString(transformed.x, transformed.y, selectedSrs);
                } else {
                    this.transformedCoordinate = this.currentMapCoordinate;
                }
            }
            this._updateFields();
            this._showFeature();
        },

        _transformCoordinate: function (x, y, targetSrs, sourceSrs) {
            var sourceSrs_ = sourceSrs || this.mbMap.getModel().getCurrentProjectionCode();
            if (window.proj4) {
                var fromProj = proj4.Proj(sourceSrs_);
                var toProj = proj4.Proj(targetSrs);
                var transformedCoordinates = proj4.transform(fromProj, toProj, [x, y]);
                return {
                    x: transformedCoordinates.x,
                    y: transformedCoordinates.y
                };
            } else if (window.OpenLayers && window.OpenLayers.LonLat) {
                var lonlat = new OpenLayers.LonLat(x, y).transform(sourceSrs_, targetSrs);
                return {
                    x: lonlat.lon,
                    y: lonlat.lat
                };
            } else {
                throw new Error("Cannot transform");
            }
        },

        _formatOutputString: function (x, y, srsCode) {
            var decimals = (this.mbMap.getModel().getProjectionUnitsPerMeter(srsCode) > 0.25) ? this.DECIMAL_METRIC : this.DECIMAL_ANGULAR;
            return x.toFixed(decimals) + this.STRING_SEPARATOR + y.toFixed(decimals);
        },

        _updateFields: function () {
            $('input.map-coordinate', this.element).val(this.currentMapCoordinate);
            $('input.input-coordinate', this.element).val(this.transformedCoordinate);
        },

        _resetFields: function () {
            this.currentMapCoordinate = null;
            this.transformedCoordinate = null;
            this.lon = null;
            this.lat = null;
            $('input.map-coordinate', this.element).val('');
            $('input.input-coordinate', this.element).val('');
            this._removeFeature();
        },

        _recalculateDisplayCoordinate: function (selectedSrs) {
            if (!selectedSrs) {
                console.error("No srs");
                return;
            }
            if (null !== this.lon && null !== this.lat) {
                var mapSrs = this.mbMap.getModel().getCurrentProjectionCode();
                if (mapSrs !== selectedSrs) {
                    var transformed = this._transformCoordinate(this.lon, this.lat, selectedSrs, mapSrs);
                    this.transformedCoordinate = this.lonLatReversed ? this._formatOutputString(transformed.y, transformed.x, selectedSrs) : this._formatOutputString(transformed.x, transformed.y, selectedSrs);
                } else {
                    this.transformedCoordinate = this._formatOutputString(this.lon, this.lat, selectedSrs);
                }
            }
            this._updateFields();
        },

        _showFeature: function () {
            this._removeFeature();
            this.highlightLayer.addMarker(this.lon, this.lat);
        },

        _removeFeature: function () {
            this.highlightLayer.clear();
        },

        _copyToClipboard: function () {
            $('input', $(this).parent()).select();
            document.execCommand("copy");
        },

        _centerMap: function () {
            if (null === this.lon || null === this.lat) {
                return;
            }
            if (this._areCoordinatesValid(this.lon, this.lat)) {
                this._showFeature();
                this.mbMap.getModel().centerXy(this.lon, this.lat, { zoom: this.options.zoomlevel });
            } else {
                Mapbender.error(Mapbender.trans("mb.coordinatesutility.widget.error.invalidCoordinates"));
            }
        },

        _areCoordinatesValid: function (x, y) {
            if (!$.isNumeric(x) || !$.isNumeric(y)) {
                return false;
            }
            var mapExtentArray = this.mbMap.getModel().getMaxExtentArray();
            return (x >= mapExtentArray[0] && x <= mapExtentArray[2] && y >= mapExtentArray[1] && y <= mapExtentArray[3]);
        },

        _transformCoordinateToMapSrs: function () {
            var selectedSrs = $('select.srs', this.element).val();
            var inputCoordinates = $('input.input-coordinate', this.element).val();
            inputCoordinates = inputCoordinates.replace(/,/g, '.');
            var inputCoordinatesArray = inputCoordinates.split(/\s+/);
            var lon, lat;

            if (this.lonLatReversed) {
                lat = parseFloat(inputCoordinatesArray[0]);
                lon = parseFloat(inputCoordinatesArray[1]);
            } else {
                lon = parseFloat(inputCoordinatesArray[0]);
                lat = parseFloat(inputCoordinatesArray[1]);
            }

            var mapProjection = this.mbMap.getModel().getCurrentProjectionCode();
            var transformed = this._transformCoordinate(lon, lat, mapProjection, selectedSrs);

            this.lon = transformed.x;
            this.lat = transformed.y;

            if (this._areCoordinatesValid(transformed.x, transformed.y)) {
                this.currentMapCoordinate = this._formatOutputString(transformed.x, transformed.y, mapProjection);
                this.transformedCoordinate = inputCoordinates;
                this._updateFields();
                this._showFeature();
            } else {
                console.error("Coordinates not valid in srs " + selectedSrs + ": Longitude " + lon + " Latitude " + lat);
            }
        }
    });
})(jQuery);
