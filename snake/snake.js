$(function() {
    var LEFT = 37
    var RIGHT = 39
    var UP = 38
    var DOWN = 40
    var direction = RIGHT;
    var $cage = $('#cage');
    var width = $cage.width();
    var height = $cage.height();
    var $snake = $('#snake');
    var snakeArray = [$snake];

    var growSnake = function() {
        var $newDot= $snake.clone();
        $cage.append($newDot);
        snakeArray.push($newDot);
    }
    growSnake();

    var growerId = setInterval(function() {
        growSnake();
    }, 1000);
    
    var top = function() { return snakeArray[0].position().top; };
    var left = function() { return snakeArray[0].position().left; };

    var collisionChecker = new Worker("snake_worker_1.js");

    var moverId = setInterval(function() {
        var checkWallMessage = ['checkWall', direction, { width: width, height: height }, {top: top(), left: left()}];
        collisionChecker.postMessage(checkWallMessage);
        
        var checkSnakeMessage = ['checkSnake', direction, {top: top(), left: left()}, {x: $.map(snakeArray, function(val,index){return val.position().left}), y: $.map(snakeArray, function(val,index){return val.position().top}) }];
        collisionChecker.postMessage(checkSnakeMessage);
    }, 50);

    var moveForward = function(direction){
           var moving = snakeArray.pop();
           var first = snakeArray[0];
           var distance = {};
           distance[RIGHT] = { y:  0, x:  5 };
           distance[LEFT]  = { y:  0, x: -5 };
           distance[UP]    = { y: -5, x:  0 };
           distance[DOWN]  = { y:  5, x:  0 };
           moving.css('top', first.position().top + distance[direction].y);
           moving.css('left', first.position().left + distance[direction].x);
           snakeArray.unshift(moving);
    };

    // Triggered by postMessage in the Web Worker
    collisionChecker.onmessage = function (evt) {
       if(evt.data[0] === "wall" && evt.data[1] === "ok"){
           moveForward(direction);
       } else if(evt.data[0] === "snake") {
           console.log("joy ride over");
           clearInterval(moverId);
       } else {
           clearInterval(moverId);
       }
    };
    // If the Web Worker throws an error
    collisionChecker.onerror = function (evt) {
       console.log("bad stuff in wokrer");
       console.log(evt.data);
    };


   $(document).keydown(function(e){
       if(direction !== e.keyCode) {
           if( (direction === RIGHT || direction === LEFT) && (e.keyCode === LEFT || e.keyCode === RIGHT)) {
             console.log("can't reverse");
           } else if ( (direction === UP || direction === DOWN) && (e.keyCode === UP || e.keyCode === DOWN)) {
             console.log("can't reverse");
           } else {
             direction = e.keyCode;
           }
       } else {
           console.log("already going that way");
       }
   }); 

});
